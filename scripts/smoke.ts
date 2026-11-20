// The acceptance test for t3-code-kit, in one Node 26 / Vite+ / Effect
// orchestrator. This is what "it works" means.
//
//   npm run smoke [-- sandbox-name]
//
// The name defaults to $T3CK_NAME, then `t3ck-smoke`. A successful run ends
// with the sandbox nuked by the durability checks; SMOKE_DOWN=1 stops it only
// when a failure leaves it running.
//
// The agent round-trip is SKIPPED by default: set SMOKE_AGENT=1 to run it. It
// spends real model tokens, so a default run does not.
//
// Every in-sandbox probe goes through one seam (`Sbx.exec`) with an explicit
// `timeoutMs` and no TTY, so a probe that never answers fails as a timeout
// instead of draining a host-side stream forever. The agent round-trip adds the
// in-sandbox `timeout` backstop, so a wedged pi is killed where it runs rather
// than left reparented to PID 1. The seam also gives a captured command no
// stdin (`ProcessRunner` passes `ignore`), which is what stopped pi's print
// mode waiting for an EOF that never came.
//
// The old `bin/smoke` and `bin/smoke.ps1` are gone; this is the only smoke
// suite. `rebuild` and `nuke` are the v2 CLI's verbs, and the durability
// assertions from ADR 0003 live here.
import { NodeServices } from "@effect/platform-node";
import { renderCapabilities } from "@t3ck/cli/capabilities";
import { resolveAgentNamePrefix, sandboxIdentity } from "@t3ck/cli/identity";
import { Git, layer as gitLayer } from "@t3ck/host/Git";
import * as HostProcess from "@t3ck/host/HostProcess";
import {
  ProcessRunner,
  layer as processRunnerLayer,
  type CommandError,
  type Result as ProcessResult,
} from "@t3ck/host/ProcessRunner";
import { parsePolicy } from "@t3ck/kit/Policy";
import { Sbx, type ExecResult } from "@t3ck/sbx/Sbx";
import { layer as sbxLayer } from "@t3ck/sbx/live";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";

import { checkBrowser } from "./browser-acceptance.ts";
import { checkDurability } from "./durability-acceptance.ts";
import { checkToolchain } from "./toolchain-acceptance.ts";

// --- pure helpers ----------------------------------------------------------

export const nonEmpty = (value: string | undefined): string | undefined =>
  value !== undefined && value.trim().length > 0 ? value.trim() : undefined;

export const positiveInt = (raw: string | undefined, fallback: number): number => {
  const parsed = Number.parseInt(raw ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

/** The Dockerfile's build-arg pin, read the same way `scripts/layout.test.ts`
 * reads it. `CHROME_VERSION` is deliberately not a kit arg (it has to track the
 * t3 binary, not an independent choice), so the descriptor cannot carry it and
 * the pin is read from the layer that uses it. */
export const dockerfileArg = (text: string, key: string): string | undefined =>
  new RegExp(`ARG ${key}=(\\S+)`, "u").exec(text)?.[1];

// --- report plumbing -------------------------------------------------------

type Status = "pass" | "fail" | "skip";

interface CheckResult {
  readonly status: Status;
  readonly label: string;
}

interface Reporter {
  readonly pass: (label: string) => Effect.Effect<void>;
  readonly fail: (label: string) => Effect.Effect<void>;
  readonly skip: (label: string) => Effect.Effect<void>;
  readonly results: Effect.Effect<ReadonlyArray<CheckResult>>;
}

const STATUS_LABEL: Record<Status, string> = {
  pass: "PASS",
  fail: "FAIL",
  skip: "SKIP",
};

const makeReporter: Effect.Effect<Reporter> = Effect.gen(function* () {
  const results = yield* Ref.make<ReadonlyArray<CheckResult>>([]);
  const add =
    (status: Status) =>
    (label: string): Effect.Effect<void> =>
      Effect.gen(function* () {
        yield* Ref.update(results, (all) => [...all, { status, label }]);
        yield* Console.log(`  ${STATUS_LABEL[status]}  ${label}`);
      });
  return {
    pass: add("pass"),
    fail: add("fail"),
    skip: add("skip"),
    results: Ref.get(results),
  };
});

const head = (title: string): Effect.Effect<void> => Console.log(`\n== ${title}`);

const printOutput = (result: ExecResult): Effect.Effect<void> =>
  Effect.gen(function* () {
    if (result.stdout.trim().length > 0) yield* Console.log(result.stdout.trimEnd());
    if (result.stderr.trim().length > 0) yield* Console.error(result.stderr.trimEnd());
  });

/** The sentence a failed probe contributes: its own message, or the exit code
 * when the command ran and said no. */
const detailOf = (
  result: Result.Result<{ readonly exitCode: number }, { readonly message: string }>,
): string =>
  Result.isFailure(result) ? result.failure.message : `exit ${result.success.exitCode}`;

// --- the suite -------------------------------------------------------------

export const runSmoke = Effect.fn("Smoke.run")(function* () {
  const sbx = yield* Sbx;
  const runner = yield* ProcessRunner;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const env = yield* HostProcess.Environment;
  const processArgs = yield* HostProcess.Arguments;
  const execPath = yield* HostProcess.ExecutablePath;

  const root = path.join(import.meta.dirname, "..");
  const name = nonEmpty(processArgs[2]) ?? nonEmpty(env.T3CK_NAME) ?? "t3ck-smoke";
  const port = positiveInt(env.T3CK_PORT, 3773);
  const repo = nonEmpty(env.SMOKE_REPO) ?? "https://github.com/juranki/t3-code-kit";
  const agentEnabled = env.SMOKE_AGENT === "1";
  const agentTimeout = positiveInt(env.SMOKE_AGENT_TIMEOUT, 120);
  const downAfter = env.SMOKE_DOWN === "1";
  const upTimeoutMs = positiveInt(env.SMOKE_UP_TIMEOUT, 3600) * 1000;
  const nukeTimeoutMs = positiveInt(env.SMOKE_NUKE_TIMEOUT, 2400) * 1000;
  const execTimeoutMs = positiveInt(env.SMOKE_EXEC_TIMEOUT, 60) * 1000;
  const reporter = yield* makeReporter;
  type SandboxState = "not-started" | "running" | "nuked" | "gone";
  const state = yield* Ref.make<SandboxState>("not-started");

  const cli = (
    args: ReadonlyArray<string>,
    timeoutMs: number,
  ): Effect.Effect<ProcessResult, CommandError> =>
    runner.run({
      bin: execPath,
      args: [path.join(root, "apps/cli/src/bin.ts"), ...args],
      env: { T3CK_NAME: name, T3CK_PORT: String(port) },
      timeoutMs,
    });

  const finish = Effect.gen(function* () {
    yield* head("summary");
    const all = yield* reporter.results;
    const passed = all.filter((result) => result.status === "pass").length;
    const failed = all.filter((result) => result.status === "fail").length;
    const skipped = all.filter((result) => result.status === "skip").length;
    yield* Console.log(`  ${passed} passed, ${failed} failed, ${skipped} skipped`);

    const current = yield* Ref.get(state);
    if (current === "nuked") {
      yield* Console.log("  sandbox was nuked by the durability checks");
    } else if (current === "gone") {
      yield* Console.log("  sandbox is gone");
    } else if (current === "not-started") {
      yield* Console.log("  sandbox was not started");
    } else if (downAfter) {
      const down = yield* cli(["down", name], 60_000).pipe(Effect.result);
      if (Result.isSuccess(down) && down.success.exitCode === 0) {
        yield* Console.log("  sandbox stopped");
      } else {
        yield* Console.log("  could not stop the sandbox");
      }
    } else {
      yield* Console.log(`  sandbox ${name} left running (SMOKE_DOWN=1 to stop it)`);
    }

    return failed === 0 ? 0 : 1;
  });

  // ---------------------------------------------------------------- static
  yield* head("static checks");

  for (const file of [
    "kit/t3-code.yaml",
    "kit/t3-code.dockerfile",
    "kit/serve.sh",
    "kit/skills.txt",
    "kit/skills.sh",
    "policy/allow.txt",
    "policy/install.txt",
  ]) {
    const exists = yield* fs.exists(path.join(root, file)).pipe(Effect.orElseSucceed(() => false));
    if (exists) {
      yield* reporter.pass(`${file} exists`);
    } else {
      yield* reporter.fail(`${file} missing`);
    }
  }

  const descriptor = yield* fs
    .readFileString(path.join(root, "kit/t3-code.yaml"))
    .pipe(Effect.orElseSucceed(() => ""));

  // The image's `CHROME_VERSION` pin, read from the Dockerfile rather than
  // duplicated here: it is not a kit arg, so the descriptor does not carry it.
  const dockerfile = yield* fs
    .readFileString(path.join(root, "kit/t3-code.dockerfile"))
    .pipe(Effect.orElseSucceed(() => ""));

  if (descriptor.length === 0) {
    yield* reporter.fail("could not read kit/t3-code.yaml");
  } else {
    // The policy mirrors must not promise anything the descriptor denies: the
    // descriptor is normative, these files are the readable copies. allow.txt
    // is runtime egress, install.txt is build-time egress; both are checked.
    const missing: Array<string> = [];
    for (const mirror of ["policy/allow.txt", "policy/install.txt"]) {
      const text = yield* fs
        .readFileString(path.join(root, mirror))
        .pipe(Effect.orElseSucceed(() => ""));
      for (const host of parsePolicy(text)) {
        if (!descriptor.includes(host)) missing.push(host);
      }
    }
    if (missing.length === 0) {
      yield* reporter.pass("policy mirrors match the descriptor");
    } else {
      yield* reporter.fail(`in a policy mirror but not in kit/t3-code.yaml: ${missing.join(", ")}`);
    }

    // `npm run policy` prints policy/allow.txt as "egress allowed at
    // runtime", so a build-time host in that file is a permission an agent acts
    // on and then gets a 403 for. The two lists must not be merged. Read the
    // install mirror rather than keeping a second copy of its hosts: adding a
    // build-time host must make this check fail, not silently pass.
    const installText = yield* fs
      .readFileString(path.join(root, "policy/install.txt"))
      .pipe(Effect.orElseSucceed(() => ""));
    const installHosts = new Set(parsePolicy(installText));
    const allowText = yield* fs
      .readFileString(path.join(root, "policy/allow.txt"))
      .pipe(Effect.orElseSucceed(() => ""));
    const leaked = parsePolicy(allowText).filter((host) => installHosts.has(host));
    if (leaked.length === 0) {
      yield* reporter.pass("policy/allow.txt lists runtime egress only");
    } else {
      yield* reporter.fail(
        `install-time hosts in policy/allow.txt (they belong in policy/install.txt): ${leaked.join(", ")}`,
      );
    }
  }

  // ---------------------------------------------------------------- doctor
  yield* head("doctor");

  const probed = yield* sbx.probe().pipe(Effect.result);
  if (Result.isFailure(probed)) {
    yield* reporter.fail(`sbx probe failed: ${probed.failure.message}`);
    return yield* finish;
  }
  for (const line of renderCapabilities(probed.success)) yield* Console.log(`  ${line}`);
  yield* reporter.pass("sbx probe reports its capabilities");

  const sandboxExists = (): Effect.Effect<boolean> =>
    sbx.list().pipe(
      Effect.map((sandboxes) => sandboxes.some((sandbox) => sandbox.name === name)),
      Effect.orElseSucceed(() => false),
    );

  // ---------------------------------------------------------------- lifecycle
  yield* head("sandbox lifecycle");

  // A sandbox that was already there is still ours to stop if `up` fails.
  if (yield* sandboxExists()) yield* Ref.set(state, "running");

  const up = yield* cli(["up", name], upTimeoutMs).pipe(Effect.result);
  if (Result.isFailure(up)) {
    yield* reporter.fail(`up could not run: ${up.failure.message}`);
    if (yield* sandboxExists()) {
      yield* Ref.set(state, "running");
      yield* Console.log(`  sandbox '${name}' exists from the failed up`);
    }
    return yield* finish;
  }
  if (up.success.exitCode !== 0) {
    yield* reporter.fail(`up failed (exit ${up.success.exitCode})`);
    yield* printOutput(up.success);
    if (yield* sandboxExists()) {
      yield* Ref.set(state, "running");
      yield* Console.log(`  sandbox '${name}' exists from the failed up`);
    }
    return yield* finish;
  }
  yield* reporter.pass("up succeeded");
  yield* Ref.set(state, "running");

  // ---------------------------------------------------------------- reachability
  yield* head("reachability");

  const curl = (url: string): Effect.Effect<boolean> =>
    runner
      .run({
        bin: "curl",
        args: ["-fsS", "-o", "-", "--max-time", "5", url],
        timeoutMs: 10_000,
      })
      .pipe(
        Effect.map((result) => result.exitCode === 0),
        Effect.orElseSucceed(() => false),
      );

  if (yield* curl(`http://localhost:${port}/`)) {
    yield* reporter.pass(`http://localhost:${port}/ answers`);
  } else {
    yield* reporter.fail(`http://localhost:${port}/ does not answer`);
  }

  const urlResult = yield* cli(["url", name], 60_000).pipe(Effect.result);
  const pairing =
    Result.isSuccess(urlResult) && urlResult.success.exitCode === 0
      ? urlResult.success.stdout
          .split(/\r?\n/u)
          .map((line) => line.trim())
          .find((line) => /^http:\/\/localhost:\d+\/pair#token=/u.test(line))
      : undefined;

  if (pairing === undefined) {
    const got = Result.isSuccess(urlResult)
      ? urlResult.success.stdout.trim() || "nothing"
      : urlResult.failure.message;
    yield* reporter.fail(`no usable pairing URL (got: ${got})`);
  } else {
    yield* reporter.pass("pairing URL minted and rewritten to localhost");
    const page = pairing.split("#")[0] ?? pairing;
    if (yield* curl(page)) {
      yield* reporter.pass("pairing page answers");
    } else {
      yield* reporter.fail("pairing page does not answer");
    }
  }

  // ---------------------------------------------------------------- toolchain
  yield* head("toolchain inside the sandbox");

  const exec = (argv: ReadonlyArray<string>, timeoutMs = execTimeoutMs) =>
    sbx.exec({ name, argv, timeoutMs });

  const skillsManifest = yield* fs
    .readFileString(path.join(root, "kit/skills.txt"))
    .pipe(Effect.orElseSucceed(() => ""));

  const toolchainChecks = yield* checkToolchain({
    name,
    descriptor,
    skillsManifest,
    timeoutMs: execTimeoutMs,
  });
  for (const check of toolchainChecks) yield* reporter[check.status](check.label);

  // ---------------------------------------------------------------- browser
  yield* head("preview browser inside the sandbox");

  const browserChecks = yield* checkBrowser({
    name,
    expectedChrome: dockerfileArg(dockerfile, "CHROME_VERSION"),
    timeoutMs: execTimeoutMs,
  });
  for (const check of browserChecks) yield* reporter[check.status](check.label);

  // ---------------------------------------------------------------- catalog
  yield* head("model catalog");

  // serve.sh refreshes pi's catalog before it starts t3, and says so in
  // serve.log. That log line is the evidence: the refresh ran and pi exited 0.
  //
  // This used to infer the same thing from ~/.pi/agent/models-store.json, which
  // was a guess about pi's on-disk layout - unverified, and it reported
  // "missing" on a sandbox whose catalog had demonstrably refreshed. Assert on
  // what the entrypoint records instead of on where pi happens to keep its
  // cache.
  const serveLog = yield* exec(["sh", "-c", "tail -n 2000 $HOME/.t3/serve.log"]).pipe(
    Effect.result,
  );
  if (Result.isFailure(serveLog) || serveLog.success.exitCode !== 0) {
    const detail = detailOf(serveLog);
    yield* reporter.fail(`could not read serve.log (${detail}) - serve.sh never ran`);
  } else if (serveLog.success.stdout.includes("model catalog refreshed")) {
    yield* reporter.pass("pi's model catalog refreshed at startup");
  } else if (serveLog.success.stdout.includes("model catalog refresh failed")) {
    yield* reporter.fail(
      `the startup refresh ran and failed - check egress to pi.dev (see: npm run logs -- ${name})`,
    );
  } else if (serveLog.success.stdout.includes("model catalog refresh timed out")) {
    yield* reporter.fail(
      `the startup refresh timed out - check egress to pi.dev (see: npm run logs -- ${name})`,
    );
  } else {
    yield* reporter.fail("no refresh line in serve.log - the startup refresh did not run");
  }

  // ---------------------------------------------------------------- egress
  yield* head("egress and credentials");

  const remote = yield* exec(["git", "ls-remote", "--exit-code", repo, "HEAD"], 60_000).pipe(
    Effect.result,
  );
  if (Result.isSuccess(remote) && remote.success.exitCode === 0) {
    yield* reporter.pass(`git ls-remote ${repo} (network + github credential)`);
  } else {
    yield* reporter.fail(
      `git ls-remote ${repo} - check policy/allow.txt and: sbx secret set github`,
    );
  }

  // The identity the CLI asserts, asserted back exactly.
  //
  // smoke runs `up` on the sandbox it checks, and `up` re-asserts the identity
  // on every run, so the host's config *now* is the one `up` just read - even
  // for a sandbox that was created on another host. The expected value is
  // computed with the CLI's own rule rather than a second copy of it, so this
  // checks the plumbing (that `up` wrote what the rule says) and not the rule,
  // which `apps/cli/src/identity.test.ts` pins.
  //
  // Exact equality is the point: a shape check ("not git's placeholder") would
  // pass the accumulation bug from #48, where the sandbox's name was
  // `Agent for Agent for ... Juhani` and still looked configured.
  const git = yield* Git;
  const expected = sandboxIdentity(
    resolveAgentNamePrefix(env.T3CK_AGENT_NAME_PREFIX),
    yield* git.identity(),
  );

  const readIdentity = (key: string): Effect.Effect<string> =>
    exec(["git", "config", "--global", key]).pipe(
      Effect.map((result) => (result.exitCode === 0 ? result.stdout.trim() : "")),
      Effect.orElseSucceed(() => ""),
    );

  const identityName = yield* readIdentity("user.name");
  const identityEmail = yield* readIdentity("user.email");

  if (identityName.length === 0) {
    yield* reporter.fail("no git user.name in the sandbox - commits get an auto-generated author");
  } else if (identityName !== expected.name) {
    yield* reporter.fail(
      `git user.name is '${identityName}', expected '${expected.name}' - a repeated prefix is #48`,
    );
  } else {
    yield* reporter.pass(`git identity name is '${identityName}' - what 'up' applied`);
  }

  if (identityEmail.length === 0) {
    yield* reporter.fail("no git user.email in the sandbox - commits get an auto-generated author");
  } else if (identityEmail !== expected.email) {
    yield* reporter.fail(`git user.email is '${identityEmail}', expected '${expected.email}'`);
  } else {
    yield* reporter.pass(`git identity email is '${identityEmail}'`);
  }

  // ---------------------------------------------------------------- agent
  yield* head("agent round-trip");

  if (!agentEnabled) {
    yield* reporter.skip("pi prompt skipped (set SMOKE_AGENT=1 to run it)");
  } else {
    // Bounded on purpose, and bounded *inside* the sandbox.
    //
    // The seam's `timeoutMs` is the host-side backstop: it kills the `sbx exec`
    // process rather than waiting for a stream that never closes. The in-sandbox
    // `timeout` is the primary bound, because killing `sbx exec` can leave the
    // remote pi running, reparented to PID 1. 124 is `timeout`'s status, so a
    // hang reads as a hang rather than as a bad answer.
    const script = `timeout ${agentTimeout} pi -p 'Reply with exactly: OK' --no-tools --no-session`;
    const agent = yield* exec(["sh", "-c", script], (agentTimeout + 15) * 1000).pipe(Effect.result);

    if (Result.isFailure(agent)) {
      yield* reporter.fail(
        `pi did not answer within ${agentTimeout}s (host bound ${agentTimeout + 15}s): ` +
          `${agent.failure.message} - it hangs under a non-TTY 'sbx exec' even when the ` +
          "provider key, its binding and egress are all fine; re-run with: " +
          `sbx exec -it ${name} -- pi -p 'Reply with exactly: OK' --no-tools --no-session`,
      );
    } else if (agent.success.exitCode === 124) {
      yield* reporter.fail(
        `pi did not answer within ${agentTimeout}s and was killed - it hangs under a ` +
          "non-TTY 'sbx exec' even when the provider key, its binding and egress are all " +
          "fine; re-run with: " +
          `sbx exec -it ${name} -- pi -p 'Reply with exactly: OK' --no-tools --no-session`,
      );
    } else if (`${agent.success.stdout}${agent.success.stderr}`.includes("fd not found")) {
      yield* reporter.fail("pi tried to download fd - the baked fd is not on PATH");
    } else if (`${agent.success.stdout}${agent.success.stderr}`.includes("OK")) {
      yield* reporter.pass("pi answered through its provider");
    } else {
      yield* reporter.fail("pi could not answer - check the provider key and its egress entry");
    }
  }

  // ---------------------------------------------------------------- durability
  yield* head("durability");

  const durability = yield* checkDurability({
    name,
    upTimeoutMs,
    nukeTimeoutMs,
    execTimeoutMs,
    runCli: cli,
  });
  for (const check of durability.checks) {
    yield* reporter[check.status](check.label);
    if (check.output !== undefined) yield* printOutput(check.output);
  }
  yield* Ref.set(state, durability.state);

  return yield* finish;
});

// --- entry -----------------------------------------------------------------

if (import.meta.main) {
  const layer = Layer.merge(gitLayer, sbxLayer).pipe(
    Layer.provideMerge(processRunnerLayer),
    Layer.provideMerge(NodeServices.layer),
  );

  const program = runSmoke().pipe(Effect.flatMap((code) => HostProcess.setExitCode(code)));
  await Effect.runPromise(program.pipe(Effect.provide(layer)));
}
