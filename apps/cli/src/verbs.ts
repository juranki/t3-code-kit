// The verbs. Each one is policy and presentation over the seam: what to ask
// `sbx`, what a non-zero exit means here, and the sentence the user sees. The
// argv sequence is the characterization contract, so the order of the calls in
// `up` matters: secret check, existence check, create/start, port, identity,
// policy, readiness, pairing URL.
import * as Console from "effect/Console";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Terminal from "effect/Terminal";

import { Git } from "@t3ck/host/Git";
import * as HostProcess from "@t3ck/host/HostProcess";
import { ProcessRunner } from "@t3ck/host/ProcessRunner";
import { parsePolicy } from "@t3ck/kit/Policy";
import {
  publishedHostPorts,
  Sbx,
  type ExecResult,
  type SandboxSummary,
  type SbxError,
  type SecretRow,
} from "@t3ck/sbx/Sbx";

import { fail, reportSbxError, say, warn, withContext, type CliError } from "./cli.ts";
import {
  CONTAINER_PORT,
  agentNamePrefix,
  kitBuilder,
  kitDirectory,
  policyPath,
  resolveName,
  resolvePort,
  resolveReadyTimeout,
} from "./config.ts";
import { sandboxIdentity } from "./identity.ts";
import { parsePairingUrl, rewritePairingUrl } from "./pairing.ts";
import { wipeVolumeContents } from "./volume-wipe.ts";

type UpEnvironment = Sbx | Git | ProcessRunner | FileSystem.FileSystem | Path.Path;

const printResult = (result: ExecResult): Effect.Effect<void> =>
  Effect.gen(function* () {
    if (result.stdout.length > 0) yield* say(result.stdout.trimEnd());
    if (result.stderr.length > 0) yield* Console.error(result.stderr.trimEnd());
  });

// --- up --------------------------------------------------------------------

const checkGithubSecret: Effect.Effect<void, never, Sbx> = Effect.gen(function* () {
  const sbx = yield* Sbx;
  // Three outcomes, not two: present, absent, and could-not-tell. Only a
  // trustworthy listing with no matching row may warn; a failed listing means
  // we never saw it, and claiming absence would invite overwriting a working
  // credential.
  const rows = yield* sbx
    .secrets()
    .pipe(Effect.orElseSucceed(() => undefined as ReadonlyArray<SecretRow> | undefined));
  if (rows === undefined) return;
  if (rows.some((row) => row.name === "github")) return;
  yield* warn("no 'github' secret on this host: clone/push will fail.");
  yield* warn("set one with:  sbx secret set github");
});

const startSandbox = (name: string): Effect.Effect<void, CliError, Sbx> =>
  Effect.gen(function* () {
    const sbx = yield* Sbx;
    const result = yield* withContext(sbx.run({ name }), `could not start sandbox '${name}'`);
    yield* printResult(result);
    if (result.exitCode !== 0) return yield* fail(`could not start sandbox '${name}'`);
  });

const createSandbox = (
  name: string,
  hostPort: number,
  kitDir: string,
  builder: string,
): Effect.Effect<void, CliError, Sbx> =>
  Effect.gen(function* () {
    const sbx = yield* Sbx;
    const result = yield* sbx
      .create({
        name,
        kitDir,
        publish: { hostPort, containerPort: CONTAINER_PORT },
        env: { SBX_KIT_BUILDER: builder },
      })
      .pipe(
        Effect.catchTags({
          SandboxExistsError: () => fail(`a sandbox named '${name}' already exists`),
          SbxNotFoundError: (error) =>
            Effect.andThen(reportSbxError(error), fail(`could not create sandbox '${name}'`)),
          SbxTimeoutError: (error) =>
            Effect.andThen(reportSbxError(error), fail(`could not create sandbox '${name}'`)),
          SbxCommandError: (error) =>
            Effect.andThen(reportSbxError(error), fail(`could not create sandbox '${name}'`)),
        }),
      );
    yield* printResult(result);
    if (result.exitCode !== 0) return yield* fail(`could not create sandbox '${name}'`);
  });

const ensurePort = (name: string, hostPort: number): Effect.Effect<void, never, Sbx> =>
  Effect.gen(function* () {
    const sbx = yield* Sbx;
    // `--publish` is ignored on re-attach, so the mapping must be re-asked. A
    // failed `ports` read is "not published", not a fatal error: the old
    // launcher pipes it through grep and falls through to publish.
    const current = yield* sbx
      .ports({ name })
      .pipe(Effect.orElseSucceed(() => undefined as ExecResult | undefined));
    if (
      current !== undefined &&
      current.exitCode === 0 &&
      publishedHostPorts(current.stdout).includes(hostPort)
    ) {
      return;
    }
    const published = yield* sbx
      .ports({ name, publish: { hostPort, containerPort: CONTAINER_PORT } })
      .pipe(Effect.orElseSucceed(() => undefined as ExecResult | undefined));
    if (published === undefined || published.exitCode !== 0) {
      yield* warn(`could not publish ${hostPort}:${CONTAINER_PORT} (see: sbx ports ${name})`);
    }
  });

const setSandboxGitConfig = (
  name: string,
  key: string,
  value: string,
): Effect.Effect<void, never, Sbx> =>
  Effect.gen(function* () {
    const sbx = yield* Sbx;
    // Base64 is pure ASCII, so the value survives every encoding layer between
    // the host and the sandbox; the decoded bytes are exactly the host's UTF-8.
    const encoded = Buffer.from(value, "utf8").toString("base64");
    const script = `git config --global ${key} "$(printf %s '${encoded}' | base64 -d)"`;
    const result = yield* sbx
      .exec({ name, argv: ["sh", "-c", script] })
      .pipe(Effect.orElseSucceed(() => undefined as ExecResult | undefined));
    if (result === undefined || result.exitCode !== 0) {
      yield* warn(
        `could not set the git identity in '${name}'; commits will carry an auto-generated author`,
      );
    }
  });

const ensureGitIdentity = (name: string, prefix: string): Effect.Effect<void, never, Sbx | Git> =>
  Effect.gen(function* () {
    const git = yield* Git;
    const identity = sandboxIdentity(prefix, yield* git.identity());

    yield* say(`git identity: ${identity.name} <${identity.email}>`);
    if (!identity.hostConfigured) {
      yield* warn(
        `no user.name/user.email on this host; using ${identity.name} <${identity.email}>.`,
      );
      yield* warn("set them with:  git config --global user.name 'Your Name'");
    }

    // Overwritten on every `up`, not only when unset: a wrong identity left by
    // a previous run is exactly the bug this fixes. The decoration is
    // idempotent, so re-running never stacks another prefix (#48).
    yield* setSandboxGitConfig(name, "user.name", identity.name);
    yield* setSandboxGitConfig(name, "user.email", identity.email);
  });

const printPolicy: Effect.Effect<void, CliError, FileSystem.FileSystem | Path.Path> = Effect.gen(
  function* () {
    const fs = yield* FileSystem.FileSystem;
    const file = yield* policyPath;
    const text = yield* fs
      .readFileString(file)
      .pipe(Effect.catch(() => fail(`could not read ${file}`)));
    const entries = parsePolicy(text);
    yield* say("");
    yield* say("egress allowed at runtime (everything else denied):");
    for (const entry of entries) yield* say(`  ${entry}`);
    yield* say("");
  },
);

const waitReady = (
  name: string,
  hostPort: number,
  timeoutSeconds: number,
): Effect.Effect<void, never, ProcessRunner> =>
  Effect.gen(function* () {
    const runner = yield* ProcessRunner;
    yield* say(`waiting for the server on http://localhost:${hostPort}/ ...`);
    let elapsed = 0;
    while (elapsed < timeoutSeconds) {
      const result = yield* runner
        .run({
          bin: "curl",
          // `-o -` discards into the pipe on every platform; `/dev/null` is not
          // a Windows path and native curl.exe would fail to open it.
          args: ["-fsS", "-o", "-", "--max-time", "2", `http://localhost:${hostPort}/`],
        })
        .pipe(Effect.orElseSucceed(() => undefined));
      if (result !== undefined && result.exitCode === 0) {
        yield* say("server is up.");
        return;
      }
      yield* Effect.sleep(Duration.seconds(2));
      elapsed += 2;
    }
    yield* warn(`no answer after ${timeoutSeconds}s. Check: npm run logs -- ${name}`);
  });

const printUrl = (name: string, hostPort: number): Effect.Effect<number, CliError, Sbx> =>
  Effect.gen(function* () {
    const sbx = yield* Sbx;
    const pair = yield* sbx
      .exec({ name, argv: ["t3", "pair"] })
      .pipe(Effect.orElseSucceed(() => undefined as ExecResult | undefined));
    const raw =
      pair !== undefined && pair.exitCode === 0 ? parsePairingUrl(pair.stdout) : undefined;
    if (raw !== undefined) {
      const url = rewritePairingUrl(raw, hostPort);
      if (url !== undefined) {
        yield* say(url);
        return 0;
      }
    }

    // t3 prints the pairing URL once at startup; read it back from the log
    // serve.sh keeps rather than minting a second token.
    const log = yield* sbx
      .exec({ name, argv: ["tail", "-n", "500", "/home/agent/.t3/serve.log"] })
      .pipe(Effect.orElseSucceed(() => undefined as ExecResult | undefined));
    const fromLog =
      log !== undefined && log.exitCode === 0 ? parsePairingUrl(log.stdout) : undefined;
    if (fromLog !== undefined) {
      const url = rewritePairingUrl(fromLog, hostPort);
      if (url !== undefined) {
        yield* say(url);
        return 0;
      }
    }

    return yield* fail(`no pairing URL: is the server up? try: npm run logs -- ${name}`);
  });

export const up = (args: ReadonlyArray<string>): Effect.Effect<number, CliError, UpEnvironment> =>
  Effect.gen(function* () {
    const name = yield* resolveName(args[0]);
    const hostPort = yield* resolvePort;
    const timeout = yield* resolveReadyTimeout;
    const kitDir = yield* kitDirectory;
    const builder = yield* kitBuilder;
    const prefix = yield* agentNamePrefix;
    const sbx = yield* Sbx;

    yield* checkGithubSecret;

    // A failed listing is "not known to exist", which is what the old
    // launchers' grep-based check did. `create` then reports the real failure.
    const sandboxes = yield* sbx
      .list()
      .pipe(Effect.orElseSucceed(() => [] as ReadonlyArray<SandboxSummary>));
    const exists = sandboxes.some((sandbox) => sandbox.name === name);

    if (exists) {
      yield* say(`sandbox '${name}' exists; starting it.`);
      yield* say(
        `note: this reuses the sandbox's existing image; run 'npm run rebuild -- ${name}' after editing kit/.`,
      );
      yield* startSandbox(name);
      // create published via -p already; asking again is a 409 Conflict.
      yield* ensurePort(name, hostPort);
    } else {
      yield* createSandbox(name, hostPort, kitDir, builder);
      yield* startSandbox(name);
    }

    yield* ensureGitIdentity(name, prefix);
    yield* printPolicy;
    yield* waitReady(name, hostPort, timeout);
    return yield* printUrl(name, hostPort);
  });

// --- url -------------------------------------------------------------------

export const url = (args: ReadonlyArray<string>): Effect.Effect<number, CliError, Sbx> =>
  Effect.gen(function* () {
    const name = yield* resolveName(args[0]);
    const hostPort = yield* resolvePort;
    return yield* printUrl(name, hostPort);
  });

// --- logs ------------------------------------------------------------------

export const logs = (args: ReadonlyArray<string>): Effect.Effect<number, CliError, Sbx> =>
  Effect.gen(function* () {
    const name = yield* resolveName(args[0]);
    const lines = args[1] ?? "200";
    const sbx = yield* Sbx;

    const first = yield* sbx
      .exec({ name, argv: ["tail", "-n", lines, "/home/agent/.t3/serve.log"] })
      .pipe(Effect.orElseSucceed(() => undefined as ExecResult | undefined));
    if (first !== undefined && first.exitCode === 0) {
      if (first.stdout.length > 0) yield* say(first.stdout.trimEnd());
      return 0;
    }

    yield* warn(`no /home/agent/.t3/serve.log in '${name}' — serve.sh never started.`);
    yield* warn("falling back to the runtime's startup-hook log:");
    const second = yield* sbx
      .exec({ name, argv: ["tail", "-n", lines, "/var/log/sbx-kit-startup.log"] })
      .pipe(Effect.orElseSucceed(() => undefined as ExecResult | undefined));
    if (second !== undefined && second.exitCode === 0) {
      if (second.stdout.length > 0) yield* say(second.stdout.trimEnd());
      return 0;
    }

    yield* warn("no startup-hook log either: the lifecycle@1 hook did not run.");
    return 0;
  });

// --- shell -----------------------------------------------------------------

export const shell = (args: ReadonlyArray<string>): Effect.Effect<number, CliError, Sbx> =>
  Effect.gen(function* () {
    const name = yield* resolveName(args[0]);
    const sbx = yield* Sbx;
    const first = yield* sbx
      .exec({ name, argv: ["bash"], tty: true })
      .pipe(Effect.orElseSucceed(() => undefined as ExecResult | undefined));
    if (first !== undefined && first.exitCode === 0) return 0;

    const second = yield* sbx
      .attach({ name })
      .pipe(Effect.orElseSucceed(() => undefined as ExecResult | undefined));
    return second?.exitCode ?? 1;
  });

// --- refresh ---------------------------------------------------------------

export const refresh = (
  args: ReadonlyArray<string>,
): Effect.Effect<number, CliError, UpEnvironment> =>
  Effect.gen(function* () {
    const name = yield* resolveName(args[0]);
    yield* say(`restarting '${name}'; serve.sh refreshes the model catalog on every start`);
    const sbx = yield* Sbx;
    const result = yield* withContext(sbx.stop({ name }), `could not stop '${name}'`);
    yield* printResult(result);
    if (result.exitCode !== 0) return yield* fail(`could not stop '${name}'`);
    return yield* up([name]);
  });

// --- down ------------------------------------------------------------------

export const down = (args: ReadonlyArray<string>): Effect.Effect<number, CliError, Sbx> =>
  Effect.gen(function* () {
    const name = yield* resolveName(args[0]);
    const sbx = yield* Sbx;
    const result = yield* withContext(sbx.stop({ name }), `could not stop '${name}'`);
    yield* printResult(result);
    if (result.exitCode !== 0) return yield* fail(`could not stop '${name}'`);
    return 0;
  });

// --- rebuild ---------------------------------------------------------------

const removeFailure =
  (name: string) =>
  (error: SbxError): Effect.Effect<never, CliError> =>
    Effect.andThen(reportSbxError(error), fail(`could not remove sandbox '${name}'`));

export const rebuild = (
  args: ReadonlyArray<string>,
): Effect.Effect<number, CliError, UpEnvironment> =>
  Effect.gen(function* () {
    const unknown = args.find((arg) => arg.startsWith("-"));
    if (unknown !== undefined) {
      return yield* fail(`unknown option '${unknown}' (rebuild takes only a sandbox name)`, 2);
    }
    const name = yield* resolveName(args[0]);
    const sbx = yield* Sbx;

    yield* say(
      `recreating '${name}' from a freshly built image; repos and t3 state survive on their volumes.`,
    );

    // A missing instance is a successful rebuild: `rm --force` says "not
    // found", and the `up` below creates it. The old launchers ignored this
    // failure (`|| true`), and the characterization suite pins that. Every
    // other seam failure is real: proceeding could reuse the instance the user
    // asked to recreate.
    const removed = yield* sbx.rm({ name, force: true }).pipe(
      Effect.catchTag("SandboxMissingError", () =>
        Effect.succeed(undefined as ExecResult | undefined),
      ),
      Effect.catchTags({
        SbxCommandError: removeFailure(name),
        SbxTimeoutError: removeFailure(name),
        SbxNotFoundError: removeFailure(name),
      }),
    );
    if (removed !== undefined) yield* printResult(removed);

    return yield* up([name]);
  });

// --- nuke ------------------------------------------------------------------

const missingSandbox = (name: string): Effect.Effect<never, CliError> =>
  fail(
    `no sandbox named '${name}': its volume contents may still be on disk. ` +
      `run 'npm run up -- ${name}', then 'npm run nuke -- ${name}'`,
    1,
  );

export const nuke = (
  args: ReadonlyArray<string>,
): Effect.Effect<number, CliError, Sbx | Terminal.Terminal> =>
  Effect.gen(function* () {
    const unknown = args.find((arg) => arg.startsWith("-") && arg !== "--yes");
    if (unknown !== undefined) {
      return yield* fail(
        `unknown option '${unknown}' (nuke takes only a sandbox name and --yes)`,
        2,
      );
    }
    const name = yield* resolveName(args.find((arg) => arg !== "--yes"));
    const sbx = yield* Sbx;

    // A failed listing is "could not tell", not "absent": the wipe's `exec`
    // then reports the truth. A trustworthy listing that lacks the name is the
    // one case where `nuke` can fail before starting a sandbox, and it must
    // fail: there is no local way to see whether its volumes still hold data.
    const sandboxes = yield* sbx
      .list()
      .pipe(Effect.orElseSucceed(() => undefined as ReadonlyArray<SandboxSummary> | undefined));
    if (sandboxes !== undefined && !sandboxes.some((sandbox) => sandbox.name === name)) {
      return yield* missingSandbox(name);
    }

    if (!args.includes("--yes")) {
      const stdinIsTTY = yield* HostProcess.StdinIsTTY;
      if (!stdinIsTTY) {
        return yield* fail(`refusing to nuke '${name}' without --yes on a non-TTY`, 2);
      }
      const terminal = yield* Terminal.Terminal;
      yield* terminal
        .display(`Type "${name}" to destroy it: `)
        .pipe(Effect.orElseSucceed(() => undefined));
      const answer = yield* terminal.readLine.pipe(Effect.orElseSucceed(() => ""));
      if (answer.trim() !== name) {
        return yield* fail("not confirmed; nothing was removed.", 2);
      }
    }

    yield* say(
      `destroying '${name}': wiping its volume contents, then removing it. This loses every repo and all t3 state.`,
    );

    const wiped = yield* wipeVolumeContents(name);
    if (wiped.kind === "missing") return yield* missingSandbox(name);
    if (wiped.kind === "dirty") {
      yield* Console.error(wiped.detail);
      return yield* fail(
        `could not wipe '${name}'; the sandbox was not removed (its data is still there)`,
        1,
      );
    }

    const removed = yield* sbx.rm({ name, force: true }).pipe(
      Effect.catchTag("SandboxMissingError", () => missingSandbox(name)),
      Effect.catchTags({
        SbxCommandError: removeFailure(name),
        SbxTimeoutError: removeFailure(name),
        SbxNotFoundError: removeFailure(name),
      }),
    );
    yield* printResult(removed);
    if (removed.exitCode !== 0) return yield* fail(`could not remove sandbox '${name}'`);

    yield* say(
      `done. '${name}' is gone; its volume storage stays allocated, empty — sbx has no per-sandbox purge.`,
    );
    return 0;
  });

// --- policy ----------------------------------------------------------------

export const policy = (): Effect.Effect<number, CliError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    yield* printPolicy;
    return 0;
  });
