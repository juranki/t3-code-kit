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
import { VOLUME_PATHS } from "@t3ck/kit/Volumes";
import { Sbx, type ExecResult } from "@t3ck/sbx/Sbx";
import { layer as sbxLayer } from "@t3ck/sbx/live";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";

// --- pure helpers ----------------------------------------------------------

export const nonEmpty = (value: string | undefined): string | undefined =>
  value !== undefined && value.trim().length > 0 ? value.trim() : undefined;

export const positiveInt = (raw: string | undefined, fallback: number): number => {
  const parsed = Number.parseInt(raw ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

/** The descriptor's build-arg default, read the same way `scripts/layout.test.ts`
 * reads it. The kit descriptor is the source of truth, so smoke never keeps a
 * second copy of a baked version. */
export const argDefault = (descriptor: string, key: string): string | undefined =>
  new RegExp(`${key}:\\s*\\n\\s*default:\\s*"([^"]+)"`, "u").exec(descriptor)?.[1];

/** `kit/skills.txt`'s rule: one name per line, blank lines and `#` comments
 * ignored. `kit/skills.sh` is the shell copy; a Windows host has no sh. */
export const countSkills = (manifest: string): number =>
  manifest
    .split(/\r?\n/u)
    .filter((line) => line.trim().length > 0 && !line.trimStart().startsWith("#")).length;

/** Parse `printf '%s ' <path>; stat -c '%d' <path>` lines into path -> device. */
export const parseDevices = (stdout: string): Record<string, string> => {
  const devices: Record<string, string> = {};
  for (const line of stdout.split(/\r?\n/u)) {
    const [volumePath, device] = line.trim().split(/\s+/u);
    if (volumePath !== undefined && device !== undefined) devices[volumePath] = device;
  }
  return devices;
};

const MARKER = ".smoke-marker";
const MARKER_TEXT = "smoke-durability-marker";
/** Entries the runtime or ext4 owns, not durable state: `sbx` recreates its
 * init stamp when a volume reattaches, and a reinitialized ext4 volume gets
 * `lost+found` back. */
const VOLUME_METADATA = [".sbx-volume-initialized", "lost+found"] as const;

/** Write the durability marker into every path. `set -e` makes a failed write
 * fail the whole probe rather than leaving a volume unmarked. */
export const writeMarkerScript = (paths: ReadonlyArray<string>): string =>
  [
    "set -e",
    ...paths.map((volumePath) => `printf '%s\\n' '${MARKER_TEXT}' > ${volumePath}/${MARKER}`),
  ].join("\n");

/** Read the markers back. A missing marker is not an error: its absence is
 * exactly what the nuke check is looking for. */
export const readMarkerScript = (paths: ReadonlyArray<string>): string =>
  ["set -e", ...paths.map((volumePath) => `cat ${volumePath}/${MARKER} 2>/dev/null || true`)].join(
    "\n",
  );

export const markerCount = (stdout: string): number =>
  stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line === MARKER_TEXT).length;

/** Normalize the three mise tools' version output. The descriptor pins exact
 * versions, so the comparison is a string equality after this. */
export const versionOf = (tool: "node" | "go" | "python", raw: string): string => {
  if (tool === "node") return raw.trim().replace(/^v/u, "");
  if (tool === "go") return /go(\d+(?:\.\d+)*)/u.exec(raw)?.[1] ?? "";
  return /(\d+(?:\.\d+)*)/u.exec(raw)?.[1] ?? "";
};

/** The Dockerfile's build-arg pin, read the same way `scripts/layout.test.ts`
 * reads it. `CHROME_VERSION` is deliberately not a kit arg (it has to track the
 * t3 binary, not an independent choice), so the descriptor cannot carry it and
 * the pin is read from the layer that uses it. */
export const dockerfileArg = (text: string, key: string): string | undefined =>
  new RegExp(`ARG ${key}=(\\S+)`, "u").exec(text)?.[1];

/** `Google Chrome for Testing 156.0.8078.70` -> `156.0.8078.70`. Empty when the
 * binary never printed a version, which is what a launch failure looks like. */
export const chromeVersionOf = (raw: string): string =>
  /Chrome for Testing (\d+(?:\.\d+)*)/u.exec(raw)?.[1] ?? "";

/** How much wider 8 `W`s render than 8 `I`s. A proportional font gives ~3.4;
 * tofu boxes give exactly 1, because every missing glyph advances by the same
 * width. That is the difference between "the page has text" and "the page has
 * boxes", which no font-file check can make. */
export const glyphRatio = (glyphs: string): number | undefined => {
  const [narrow, wide] = glyphs.split(",").map((value) => Number.parseFloat(value));
  if (narrow === undefined || wide === undefined) return undefined;
  if (!Number.isFinite(narrow) || !Number.isFinite(wide) || narrow <= 0) return undefined;
  return wide / narrow;
};

/** The directory chrome-for-testing publishes for this machine, which is also
 * the one t3 installs under. Restated here rather than imported from the
 * Dockerfile: the point of the check is to compare the image against an
 * independent statement of where t3 looks, and a shared constant would only
 * compare the image with itself. `undefined` for a machine neither knows. */
export const chromePlatformOf = (machine: string): string | undefined => {
  if (machine === "x86_64" || machine === "amd64") return "linux64";
  if (machine === "aarch64" || machine === "arm64") return "linux-arm64";
  return undefined;
};

/** One `sbx exec` that answers everything the browser section asserts. The
 * binary is found by glob rather than by a pinned path: the image pre-seeds it
 * under the version t3 names, and the arch directory differs by host. */
export const browserProbeScript = (): string =>
  [
    "bin=$(ls -d /home/agent/.t3/tools/chrome-headless-shell/*/*/chrome-headless-shell 2>/dev/null | head -1)",
    'echo "bin=$bin"',
    'echo "machine=$(uname -m)"',
    'if [ -n "$bin" ]; then',
    '  echo "missing=$(ldd "$bin" 2>/dev/null | grep -c "not found")"',
    '  echo "version=$("$bin" --version 2>/dev/null)"',
    // Same count of a narrow and a wide glyph, measured by the browser itself.
    // Equal widths mean tofu; a proportional font means real outlines.
    `  glyphs=$("$bin" --headless --virtual-time-budget=3000 --dump-dom "data:text/html,<body><span id=a style='font:40px sans-serif'>IIIIIIII</span><span id=b style='font:40px sans-serif'>WWWWWWWW</span><script>document.title=[a.getBoundingClientRect().width,b.getBoundingClientRect().width].join(',')</script>" 2>/dev/null | grep -o "<title>[0-9.,]*</title>" | tr -d "<title>/")`,
    '  echo "glyphs=$glyphs"',
    // The sandbox proxy re-signs TLS with a per-sandbox CA, which serve.sh
    // imports into NSS. If that import did not happen, every https:// origin
    // fails with ERR_CERT_AUTHORITY_INVALID and the DOM never arrives.
    '  if "$bin" --headless --virtual-time-budget=5000 --dump-dom https://github.com 2>/dev/null | grep -q "<title>"; then echo "tls=ok"; else echo "tls="; fi',
    "fi",
    "font=$(fc-match --format=%{file} sans-serif 2>/dev/null)",
    // fc-match prints the pattern back when nothing matches, so "resolved" is
    // a path that is actually a file.
    'if [ -f "$font" ]; then echo "font=$font"; else echo "font="; fi',
  ].join("\n");

export interface BrowserProbe {
  readonly bin: string | undefined;
  readonly machine: string | undefined;
  readonly missing: number | undefined;
  readonly version: string | undefined;
  readonly font: string | undefined;
  readonly glyphs: string | undefined;
  readonly tls: string | undefined;
}

/** The probe's `key=value` lines. An empty value is absent, not empty string:
 * `bin=` is what a sandbox without a pre-seeded browser reports. */
export const parseBrowserProbe = (stdout: string): BrowserProbe => {
  const fields: Record<string, string> = {};
  for (const line of stdout.split(/\r?\n/u)) {
    const match = /^(bin|machine|missing|version|font|glyphs|tls)=(.*)$/u.exec(line.trim());
    if (match !== null && (match[2] ?? "").trim().length > 0)
      fields[match[1] ?? ""] = (match[2] ?? "").trim();
  }
  const missing = Number.parseInt(fields.missing ?? "", 10);
  return {
    bin: fields.bin,
    machine: fields.machine,
    missing: Number.isInteger(missing) ? missing : undefined,
    version: fields.version,
    font: fields.font,
    glyphs: fields.glyphs,
    tls: fields.tls,
  };
};

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

  const checkExec = (label: string, command: string): Effect.Effect<void> =>
    Effect.gen(function* () {
      const result = yield* exec(["sh", "-c", command]).pipe(Effect.result);
      if (Result.isFailure(result)) {
        yield* reporter.fail(`${label}: ${result.failure.message}`);
      } else if (result.success.exitCode !== 0) {
        const stderr = result.success.stderr.trim();
        yield* reporter.fail(
          `${label}: exit ${result.success.exitCode}${stderr.length > 0 ? ` (${stderr})` : ""}`,
        );
      } else {
        yield* reporter.pass(label);
      }
    });

  for (const command of ["t3 --version", "pi --version", "git --version", "mise --version"]) {
    yield* checkExec(command, command);
  }

  // A UTF-8 locale, or a terminal in the sandbox cannot type a non-ASCII
  // character and renders correct UTF-8 as mojibake. Checked by round-tripping
  // a real character rather than by reading $LANG: the variable being set is
  // not the same as the locale working.
  const utf8 = yield* exec(["sh", "-c", 'printf "\\303\\244" | od -An -c']).pipe(Effect.result);
  if (
    Result.isSuccess(utf8) &&
    utf8.success.exitCode === 0 &&
    /303\s+244/u.test(utf8.success.stdout)
  ) {
    yield* reporter.pass("non-ASCII bytes survive a round-trip");
  } else {
    yield* reporter.fail("non-ASCII bytes do not survive a round-trip");
  }

  const locale = yield* exec(["sh", "-c", 'printf "%s" "$LC_ALL"']).pipe(Effect.result);
  if (Result.isSuccess(locale) && /utf-?8/iu.test(locale.success.stdout)) {
    yield* reporter.pass("sandbox locale is UTF-8");
  } else {
    yield* reporter.fail("sandbox locale is not UTF-8 (LC_ALL is not set to a UTF-8 locale)");
  }

  // mise's shims, not the base image's node / go / python. `sbx exec` runs a
  // non-interactive shell, which is exactly where `mise activate` would never
  // have fired - so this is the assertion that catches a PATH-ordering
  // regression here, instead of it surfacing later as "the agent used the
  // wrong node".
  const shimScript = [
    'echo "node=$(node --version 2>&1)"',
    'echo "go=$(go version 2>&1)"',
    'echo "python=$(python --version 2>&1)"',
    'echo "node_path=$(command -v node)"',
    'echo "go_path=$(command -v go)"',
    'echo "python_path=$(command -v python)"',
  ].join("\n");
  const shimResult = yield* exec(["sh", "-c", shimScript]).pipe(Effect.result);
  if (Result.isFailure(shimResult) || shimResult.success.exitCode !== 0) {
    const detail = detailOf(shimResult);
    yield* reporter.fail(`could not read the mise shims: ${detail}`);
  } else {
    const fields: Record<string, string> = {};
    for (const line of shimResult.success.stdout.split(/\r?\n/u)) {
      const match = /^(node|go|python)(_path)?=(.*)$/u.exec(line.trim());
      if (match !== null) fields[`${match[1]}${match[2] ?? ""}`] = (match[3] ?? "").trim();
    }

    const checkShim = (tool: "node" | "go" | "python"): Effect.Effect<void> =>
      Effect.gen(function* () {
        const want = argDefault(descriptor, `${tool}Version`);
        const got = versionOf(tool, fields[tool] ?? "");
        const shimPath = fields[`${tool}_path`] ?? "";
        const expectedPath = `/home/agent/.local/share/mise/shims/${tool}`;
        if (want === undefined) {
          yield* reporter.fail(`${tool}: no ${tool}Version default in kit/t3-code.yaml`);
        } else if (shimPath !== expectedPath) {
          yield* reporter.fail(
            `${tool} resolves to ${shimPath || "nothing"}, not the mise shim (${expectedPath})`,
          );
        } else if (got !== want) {
          yield* reporter.fail(
            `${tool} reports ${got || "nothing"}, want ${want} (the baked version)`,
          );
        } else {
          yield* reporter.pass(`${tool} ${got} through the mise shim`);
        }
      });

    yield* checkShim("node");
    yield* checkShim("go");
    yield* checkShim("python");
  }

  // Vite+ and fd are not mise's: Vite+ is a global npm install and fd is a
  // pinned release binary in /usr/local/bin. They follow the same rule as the
  // shims - the version reported inside the sandbox must be the descriptor's
  // default - so a kit-arg bump that misses the image fails here.
  const checkToolVersion = (
    label: string,
    command: string,
    key: string,
    pattern: RegExp,
  ): Effect.Effect<void> =>
    Effect.gen(function* () {
      const want = argDefault(descriptor, key);
      const result = yield* exec(["sh", "-c", command]).pipe(Effect.result);
      if (Result.isFailure(result)) {
        yield* reporter.fail(`${label}: ${result.failure.message}`);
        return;
      }
      if (result.success.exitCode !== 0) {
        yield* reporter.fail(`${label}: exit ${result.success.exitCode}`);
        return;
      }
      const got = pattern.exec(result.success.stdout)?.[1];
      if (want === undefined) {
        yield* reporter.fail(`${label}: no ${key} default in kit/t3-code.yaml`);
      } else if (got !== want) {
        yield* reporter.fail(
          `${label} reports ${got ?? "nothing"}, want ${want} (the baked version)`,
        );
      } else {
        yield* reporter.pass(`${label} ${got} is the baked version`);
      }
    });

  yield* checkToolVersion(
    "vp",
    "vp --version 2>/dev/null",
    "vitePlusVersion",
    /vp v(\d+(?:\.\d+)*)/u,
  );
  yield* checkToolVersion("fd", "fd --version", "fdVersion", /^fd (\d+(?:\.\d+)*)/mu);
  // Codex is the second agent t3 can drive. This only proves the binary and
  // its platform package are baked; enabling it in the UI and its credential
  // are the host's job, like pi's provider record.
  yield* checkToolVersion(
    "codex",
    "codex --version 2>/dev/null",
    "codexVersion",
    /^codex-cli (\d+(?:\.\d+)*)/mu,
  );

  // Java is the base image's OpenJDK 21, not mise's: mise-java.jdx.dev is not
  // in the allowlist and the base image already carries a JDK. This asserts the
  // PATH append actually reaches it. `java -version` writes to stderr.
  const java = yield* exec(["sh", "-c", "java -version"]).pipe(Effect.result);
  if (
    Result.isSuccess(java) &&
    /openjdk version "21/u.test(`${java.success.stdout}${java.success.stderr}`)
  ) {
    yield* reporter.pass("java -version is the base image's OpenJDK 21");
  } else {
    const first = Result.isSuccess(java)
      ? `${java.success.stdout}${java.success.stderr}`
          .split(/\r?\n/u)
          .find((line) => line.length > 0)
      : undefined;
    yield* reporter.fail(`java -version is not OpenJDK 21: ${first ?? "nothing"}`);
  }

  // mise pulls ca-certificates-bundle, which ships its own copy of
  // /etc/ssl/certs/ca-certificates.crt. Without --force-confold dpkg stops at
  // the conffile prompt and leaves both packages in state iU: mise still runs,
  // but the next apt operation fails. dpkg --audit is the assertion that the
  // flag is there; replacing the bundle instead shows up as a TLS failure in
  // the egress check below.
  const auditScript = 'echo "audit=$(dpkg --audit 2>&1 | tr "\\n" " ")"';
  const audit = yield* exec(["sh", "-c", auditScript]).pipe(Effect.result);
  if (Result.isFailure(audit) || audit.success.exitCode !== 0) {
    const detail = detailOf(audit);
    yield* reporter.fail(`dpkg --audit could not run: ${detail}`);
  } else {
    const auditText = /^audit=(.*)$/mu.exec(audit.success.stdout)?.[1]?.trim() ?? "";
    if (auditText.length === 0) {
      yield* reporter.pass("dpkg --audit is clean");
    } else {
      yield* reporter.fail(`dpkg --audit reports unconfigured packages: ${auditText}`);
    }
  }

  const mount = yield* exec(["sh", "-c", "mountpoint -q /home/agent/workspace"]).pipe(
    Effect.result,
  );
  if (Result.isSuccess(mount) && mount.success.exitCode === 0) {
    yield* reporter.pass("/home/agent/workspace is a volume mount, not a host mount");
  } else {
    yield* reporter.fail("/home/agent/workspace is not a volume mount");
  }

  // The UI's terminal is whatever t3 spawns from the server's $SHELL, and the
  // platform starts the workload with SHELL=/bin/sh - dash, which has no
  // readline: no history, no completion, no prompt colors. serve.sh exports
  // bash. Read the *running* server's environment, not serve.sh: the failure
  // this catches is a server that started before the export existed.
  const shellScript =
    'tr "\\0" "\\n" < /proc/$(pgrep -f "^t3 serve" | head -1)/environ 2>/dev/null | sed -n "s/^SHELL=//p"';
  const serverShell = yield* exec(["sh", "-c", shellScript]).pipe(Effect.result);
  const shellValue = Result.isSuccess(serverShell)
    ? (serverShell.success.stdout
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .find((line) => line.length > 0) ?? "")
    : "";
  if (shellValue === "/bin/bash") {
    yield* reporter.pass(
      "t3 serve runs with SHELL=/bin/bash (the terminal has history and completion)",
    );
  } else {
    yield* reporter.fail(
      `t3 serve has SHELL=${shellValue || "unknown"}: the UI terminal falls back to dash`,
    );
  }

  // Skills are baked into the image, and the Dockerfile already asserts the
  // count against kit/skills.txt. This is the other failure: an image built
  // before skills were baked in, or a RUN that never executed.
  const manifest = yield* fs
    .readFileString(path.join(root, "kit/skills.txt"))
    .pipe(Effect.orElseSucceed(() => ""));
  const skillsWant = countSkills(manifest);
  const skillsScript =
    'echo "skills=$(ls -1 /home/agent/.agents/skills 2>/dev/null | wc -l | tr -d " ")"';
  const skills = yield* exec(["sh", "-c", skillsScript]).pipe(Effect.result);
  const skillsHave = Result.isSuccess(skills)
    ? Number.parseInt(/^skills=(\d+)$/mu.exec(skills.success.stdout)?.[1] ?? "", 10)
    : Number.NaN;
  if (skillsWant > 0 && skillsHave === skillsWant) {
    yield* reporter.pass(`${skillsWant} skills baked in, kit/skills.txt agrees`);
  } else {
    yield* reporter.fail(
      `skills: ${Number.isNaN(skillsHave) ? 0 : skillsHave} baked in, ${skillsWant} in kit/skills.txt`,
    );
  }

  // ---------------------------------------------------------------- browser
  yield* head("preview browser inside the sandbox");

  // t3 downloads chrome-headless-shell from storage.googleapis.com on first
  // render, and this kit's runtime policy refuses that host - so the image
  // pre-seeds the binary at the version the baked t3 names. These are the
  // assertions that the layer landed, in the order a launch fails: no binary,
  // then a loader that cannot find a library, then a binary that starts, then
  // fonts (a browser with no font renders empty boxes, not text).
  const browserProbe = yield* exec(["sh", "-c", browserProbeScript()]).pipe(Effect.result);
  if (Result.isFailure(browserProbe) || browserProbe.success.exitCode !== 0) {
    // The checks below cannot say anything, so they are skipped rather than
    // dropped: a suite whose count silently shrinks hides the gap.
    yield* reporter.fail(`the browser probe failed (${detailOf(browserProbe)})`);
    for (const label of [
      "the preview browser is baked in where t3 looks",
      "ldd reports no missing libraries",
      "chrome-headless-shell starts",
      "fc-match resolves sans-serif to a font file",
      "the browser renders proportional glyphs",
      "the browser renders an HTTPS origin",
    ]) {
      yield* reporter.skip(label);
    }
  } else {
    const probe = parseBrowserProbe(browserProbe.success.stdout);
    const wantChrome = dockerfileArg(dockerfile, "CHROME_VERSION");
    const wantPlatform = chromePlatformOf(probe.machine ?? "");
    const wantBin =
      wantChrome === undefined || wantPlatform === undefined
        ? undefined
        : `/home/agent/.t3/tools/chrome-headless-shell/${wantPlatform}/${wantChrome}/chrome-headless-shell`;

    if (wantChrome === undefined) {
      yield* reporter.fail("no CHROME_VERSION pin in kit/t3-code.dockerfile");
    } else if (probe.bin === undefined) {
      yield* reporter.fail(
        "no chrome-headless-shell under ~/.t3/tools - the image did not bake it in",
      );
    } else if (wantBin === undefined) {
      yield* reporter.fail(`no chrome-for-testing platform for ${probe.machine ?? "unknown"}`);
    } else if (probe.bin !== wantBin) {
      // t3 looks in exactly this path; a binary anywhere else is one t3 ignores
      // and re-downloads, which the runtime policy refuses.
      yield* reporter.fail(`the preview browser is at ${probe.bin}, want ${wantBin}`);
    } else {
      yield* reporter.pass(`the preview browser is baked in at ${probe.bin}`);
    }

    if (probe.missing === undefined) {
      yield* reporter.fail("ldd could not be run against the preview browser");
    } else if (probe.missing === 0) {
      yield* reporter.pass("ldd reports no missing libraries");
    } else {
      yield* reporter.fail(`ldd reports ${probe.missing} missing libraries`);
    }

    const gotChrome = chromeVersionOf(probe.version ?? "");
    if (wantChrome === undefined) {
      yield* reporter.fail("no CHROME_VERSION pin in kit/t3-code.dockerfile");
    } else if (gotChrome === wantChrome) {
      yield* reporter.pass(`chrome-headless-shell ${gotChrome} starts`);
    } else {
      yield* reporter.fail(
        `chrome-headless-shell reports ${gotChrome || "nothing"}, want ${wantChrome} (the Dockerfile pin)`,
      );
    }

    if (probe.font !== undefined) {
      yield* reporter.pass(`fc-match resolves sans-serif to ${probe.font}`);
    } else {
      yield* reporter.fail("fc-match does not resolve sans-serif to a font file");
    }

    // A font file on disk is not the same as a glyph on screen: this is the
    // browser's own text measurement, so a fontconfig cache problem that leaves
    // the browser drawing boxes fails here and not in someone's screenshot.
    const ratio = glyphRatio(probe.glyphs ?? "");
    if (ratio === undefined) {
      yield* reporter.fail("the browser did not report a text measurement");
    } else if (ratio > 1.5) {
      yield* reporter.pass(
        `the browser renders proportional glyphs (W/I width ${ratio.toFixed(1)})`,
      );
    } else {
      yield* reporter.fail(
        `the browser renders every glyph at one width (W/I ${ratio.toFixed(1)}) - boxes, not text`,
      );
    }

    // The sandbox proxy re-signs TLS with a CA minted per sandbox, and Chromium
    // does not read SSL_CERT_FILE: serve.sh imports that CA into the NSS store
    // the browser does read. Without it every https:// origin is a certificate
    // error, which breaks any preview that pulls a CDN resource.
    if (probe.tls === "ok") {
      yield* reporter.pass("the browser renders an HTTPS origin (github.com)");
    } else {
      yield* reporter.fail(
        "the browser cannot render an HTTPS origin - the proxy CA is not in its NSS store (see kit/serve.sh)",
      );
    }
  }

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

  const readDevices = (
    paths: ReadonlyArray<string>,
  ): Effect.Effect<Record<string, string> | undefined> =>
    exec([
      "sh",
      "-c",
      paths
        .map((volumePath) => `printf '%s ' '${volumePath}'; stat -c '%d' '${volumePath}'`)
        .join("\n"),
    ]).pipe(
      Effect.map((result) => (result.exitCode === 0 ? parseDevices(result.stdout) : undefined)),
      Effect.orElseSucceed(() => undefined),
    );

  // 1. `rebuild` keeps durable state: a marker in .t3/userdata and workspace
  //    survives `rm --force` + `create`.
  const rebuildPaths = ["/home/agent/.t3/userdata", "/home/agent/workspace"];
  const wroteRebuild = yield* exec(["sh", "-c", writeMarkerScript(rebuildPaths)]).pipe(
    Effect.result,
  );
  if (Result.isFailure(wroteRebuild) || wroteRebuild.success.exitCode !== 0) {
    yield* reporter.fail(`could not write the rebuild marker: ${detailOf(wroteRebuild)}`);
  } else {
    const rebuilt = yield* cli(["rebuild", name], upTimeoutMs).pipe(Effect.result);
    if (Result.isFailure(rebuilt)) {
      yield* reporter.fail(`rebuild could not run: ${rebuilt.failure.message}`);
    } else if (rebuilt.success.exitCode !== 0) {
      yield* reporter.fail(`rebuild failed (exit ${rebuilt.success.exitCode})`);
      yield* printOutput(rebuilt.success);
    } else {
      const read = yield* exec(["sh", "-c", readMarkerScript(rebuildPaths)]).pipe(Effect.result);
      if (Result.isFailure(read) || read.success.exitCode !== 0) {
        yield* reporter.fail(`could not read the rebuild marker: ${detailOf(read)}`);
      } else if (markerCount(read.success.stdout) === rebuildPaths.length) {
        yield* reporter.pass("rebuild kept the marker in .t3/userdata and workspace");
      } else {
        yield* reporter.fail("rebuild lost the marker: durable state did not survive");
      }
    }
  }

  if (!(yield* sandboxExists())) {
    yield* Ref.set(state, "gone");
    yield* reporter.fail("sandbox is gone after rebuild; skipping the nuke checks");
    return yield* finish;
  }

  // 2. `nuke` without `--yes` on a non-TTY refuses and removes nothing.
  const refused = yield* cli(["nuke", name], nukeTimeoutMs).pipe(Effect.result);
  if (Result.isSuccess(refused) && refused.success.exitCode !== 0) {
    if (yield* sandboxExists()) {
      yield* reporter.pass("nuke without --yes on a non-TTY refused and removed nothing");
    } else {
      yield* reporter.fail("nuke without --yes removed the sandbox");
    }
  } else {
    yield* reporter.fail(
      `nuke without --yes did not refuse (exit ${
        Result.isSuccess(refused) ? refused.success.exitCode : "unknown"
      })`,
    );
  }

  // 3. `nuke` wipes the four volumes' contents; `up` the same name reattaches
  //    the same volume objects, empty. The marker is the proof the old data is
  //    gone; the device number is the proof the volume object was retained
  //    rather than freshly allocated.
  const devicesBefore = yield* readDevices(VOLUME_PATHS);
  const wroteAll = yield* exec(["sh", "-c", writeMarkerScript(VOLUME_PATHS)]).pipe(Effect.result);
  if (Result.isFailure(wroteAll) || wroteAll.success.exitCode !== 0) {
    yield* reporter.fail(`could not write the nuke marker: ${detailOf(wroteAll)}`);
  } else if (devicesBefore === undefined) {
    yield* reporter.fail("could not read the volume devices before nuke");
  } else {
    const nukedResult = yield* cli(["nuke", name, "--yes"], nukeTimeoutMs).pipe(Effect.result);
    if (Result.isFailure(nukedResult)) {
      yield* reporter.fail(`nuke could not run: ${nukedResult.failure.message}`);
    } else if (nukedResult.success.exitCode !== 0) {
      yield* reporter.fail(`nuke failed (exit ${nukedResult.success.exitCode})`);
      yield* printOutput(nukedResult.success);
    } else {
      yield* Ref.set(state, "nuked");
      yield* reporter.pass("nuke wiped the volumes and removed the instance");

      const upAgain = yield* cli(["up", name], upTimeoutMs).pipe(Effect.result);
      if (Result.isFailure(upAgain)) {
        yield* reporter.fail(`up after nuke could not run: ${upAgain.failure.message}`);
      } else if (upAgain.success.exitCode !== 0) {
        yield* reporter.fail(`up after nuke failed (exit ${upAgain.success.exitCode})`);
        yield* printOutput(upAgain.success);
      } else {
        yield* Ref.set(state, "running");

        const read = yield* exec(["sh", "-c", readMarkerScript(VOLUME_PATHS)]).pipe(Effect.result);
        if (Result.isFailure(read) || read.success.exitCode !== 0) {
          yield* reporter.fail(`could not read the nuke marker: ${detailOf(read)}`);
        } else if (markerCount(read.success.stdout) === 0) {
          yield* reporter.pass("nuke left no marker in any of the four volumes");
        } else {
          yield* reporter.fail("a marker survived nuke: the wipe did not destroy the data");
        }

        // `.t3/userdata` is not asserted empty: t3 writes its own state there
        // on startup. `workspace` is the volume nothing else recreates, so it
        // is the one that must have no user entries. The runtime's init stamp
        // and ext4's `lost+found` are metadata, not durable state.
        const workspace = VOLUME_PATHS[0];
        const metadataFilter = VOLUME_METADATA.map((entry) => `! -name '${entry}'`).join(" ");
        // `-maxdepth 1` is load-bearing: `lost+found` is root-owned and mode
        // 700, so descending into it makes `find` exit non-zero with EACCES
        // even though the only entry is metadata.
        const workspaceEntries = yield* exec([
          "sh",
          "-c",
          `find ${workspace} -mindepth 1 -maxdepth 1 ${metadataFilter} -print`,
        ]).pipe(Effect.result);
        if (
          Result.isSuccess(workspaceEntries) &&
          workspaceEntries.success.exitCode === 0 &&
          workspaceEntries.success.stdout.trim().length === 0
        ) {
          yield* reporter.pass("workspace has no entries after nuke + up");
        } else {
          const detail = Result.isFailure(workspaceEntries)
            ? workspaceEntries.failure.message
            : workspaceEntries.success.exitCode !== 0
              ? workspaceEntries.success.stderr.trim() ||
                `exit ${workspaceEntries.success.exitCode}`
              : workspaceEntries.success.stdout.trim();
          yield* reporter.fail(`workspace is not empty after nuke + up: ${detail}`);
        }

        const devicesAfter = yield* readDevices(VOLUME_PATHS);
        if (devicesAfter === undefined) {
          yield* reporter.fail("could not read the volume devices after nuke");
        } else if (
          VOLUME_PATHS.every((volumePath) => devicesBefore[volumePath] === devicesAfter[volumePath])
        ) {
          yield* reporter.pass("the four volume objects are the same (still allocated)");
        } else {
          yield* reporter.fail("the volumes changed after nuke: retention did not hold");
        }
      }
    }
  }

  // 4. `nuke` on a missing instance fails, and a second nuke removes the
  //    recreated instance.
  if (yield* sandboxExists()) {
    const finalNuke = yield* cli(["nuke", name, "--yes"], nukeTimeoutMs).pipe(Effect.result);
    if (Result.isSuccess(finalNuke) && finalNuke.success.exitCode === 0) {
      yield* Ref.set(state, "nuked");
      yield* reporter.pass("nuke removed the recreated instance");
    } else {
      yield* reporter.fail(
        `nuke could not remove the recreated instance (exit ${
          Result.isSuccess(finalNuke) ? finalNuke.success.exitCode : "unknown"
        })`,
      );
    }
  }

  const missing = yield* cli(["nuke", name, "--yes"], nukeTimeoutMs).pipe(Effect.result);
  if (Result.isSuccess(missing) && missing.success.exitCode !== 0) {
    yield* reporter.pass("nuke on a missing instance exits non-zero");
  } else {
    yield* reporter.fail("nuke on a missing instance succeeded");
    yield* Ref.set(state, "nuked");
  }

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
