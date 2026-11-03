// Probe the local `sbx` runtime: what it is, what its volume commands actually
// do, and which of the kit's four volumes survive each lifecycle step.
//
// Run on the Windows host, from the repo root:
//
//     node scripts/probe-sbx.ts
//
// The output is one text report on stdout, also written to
// `probe-sbx-<timestamp>.log` in the working directory. Paste or attach that
// file; the capability matrix on #30 is derived from it, and no cell is filled
// in without a captured line behind it.
//
// ── SAFETY ──────────────────────────────────────────────────────────────────
// This script is destructive, and it is destructive only to itself.
//
//   * It creates its own scratch sandbox, `t3ck-probe`, and refuses to start if
//     a sandbox by that name already exists: a pre-existing one is not ours.
//   * Every `sbx rm` and `sbx volume rm` goes through `destroy()`, which asserts
//     the target is exactly `t3ck-probe` and aborts otherwise. There is no code
//     path in this file that removes any other sandbox or any volume that does
//     not name `t3ck-probe`.
//   * It never reads, copies, prints or writes `%APPDATA%\sbx\credentials.yaml`
//     or any other credential file. `sbx secret ls` is deliberately NOT run: its
//     output can carry credential material, and this log is meant to be pasted
//     into a public issue. The secret listing's shape is already pinned by
//     `apps/cli/src/verbs.test.ts`; nothing here needs it.
//   * It publishes a host port (3799 by default; PROBE_PORT overrides) and
//     removes the sandbox when it is done.
//
// ── COST ────────────────────────────────────────────────────────────────────
// The first `create` builds the kit image, and that is the slow part: roughly
// 5–20 minutes on a cold cache. Every later `create` in this run reuses the
// cached image, so the whole probe is one build and three cheap recreates.
// Expect ~10–25 minutes cold, ~3–6 minutes warm. Every phase prints how long it
// took, so the log says which it was.
//
// ── WHY THIS SHAPE ──────────────────────────────────────────────────────────
// The argv mirrors what the v2 CLI asks `sbx` (create/run/stop/rm/exec), so the
// probe asks the same questions the CLI asks. The one deliberate difference is
// the sandbox name, which is fixed rather than taken from T3CK_NAME: a probe
// that can be pointed at a real sandbox is a probe that can destroy one.

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";

// ── constants ───────────────────────────────────────────────────────────────

/** The only sandbox this script may create, stop, exec in, or remove. */
const SCRATCH = "t3ck-probe";

/** The kit descriptor directory, as the CLI passes it to `create`. */
const KIT = resolve(import.meta.dirname, "..", "kit");

/** `sbx` honours $SBX in the CLI, so the probe does too. */
const SBX = process.env.SBX?.trim() || "sbx";

/** Host port for the scratch sandbox. Unused by the probe, published for fidelity. */
const PORT = process.env.PROBE_PORT ?? "3799";
const CONTAINER_PORT = "3773";

/** Set PROBE_YES=1 to skip the confirmation prompt (CI-ish, or a second run). */
const PROBE_YES = process.env.PROBE_YES === "1";

/** Set PROBE_PI=0 to skip the pi round-trip (#24). It spends real model tokens. */
const PROBE_PI = process.env.PROBE_PI !== "0";

/**
 * The four volumes the kit declares, in descriptor order. `name` is the short
 * label used in the matrix; `path` is the mount point inside the sandbox.
 */
const VOLUMES = [
  { name: "workspace", path: "/home/agent/workspace" },
  { name: "userdata", path: "/home/agent/.t3/userdata" },
  { name: "projects", path: "/home/agent/.t3/projects" },
  { name: "worktrees", path: "/home/agent/.t3/worktrees" },
] as const;

/** Marker file dropped at the root of every volume. */
const MARKER = ".probe-marker";

/** A fresh token per run, so a stale marker from an earlier run cannot pass. */
const RUN_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

// ── report plumbing ─────────────────────────────────────────────────────────

const report: string[] = [];

const emit = (line = ""): void => {
  report.push(line);
  process.stdout.write(`${line}\n`);
};

const banner = (title: string): void => {
  emit("");
  emit(`════════ ${title} ════════`);
};

const note = (line: string): void => {
  emit(`# ${line}`);
};

// ── process plumbing ────────────────────────────────────────────────────────

interface RunResult {
  readonly argv: ReadonlyArray<string>;
  readonly status: number | null;
  readonly signal: string | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
  readonly missing: boolean;
  readonly durationMs: number;
  readonly spawnError: string | null;
}

const MAX_STREAM = 12_000;

const clip = (text: string): string => {
  if (text.length <= MAX_STREAM) return text;
  return `${text.slice(0, MAX_STREAM)}\n…[${text.length - MAX_STREAM} more characters clipped]`;
};

const quote = (arg: string): string =>
  /[\s"]/.test(arg) ? `"${arg.replaceAll('"', '\\"')}"` : arg;

const spawn = (argv: ReadonlyArray<string>, timeoutMs: number): RunResult => {
  const started = Date.now();
  const result = spawnSync(argv[0]!, argv.slice(1), {
    encoding: "utf8",
    timeout: timeoutMs,
    windowsHide: true,
    maxBuffer: 32 * 1024 * 1024,
    shell: false,
  });
  const code = (result.error as NodeJS.ErrnoException | undefined)?.code;
  return {
    argv,
    status: result.status,
    signal: result.signal,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    timedOut: code === "ETIMEDOUT",
    missing: code === "ENOENT",
    durationMs: Date.now() - started,
    spawnError: result.error === undefined ? null : String(result.error.message),
  };
};

/**
 * Run a command, print it and its raw output, and return the result.
 *
 * A failing command is data here, not an error: the probe records the exit code
 * and the message and carries on, because "this verb does not exist locally" is
 * exactly one of the answers it is looking for.
 */
const run = (
  argv: ReadonlyArray<string>,
  options: { readonly timeoutMs?: number; readonly quiet?: boolean } = {},
): RunResult => {
  const result = spawn(argv, options.timeoutMs ?? 120_000);
  if (!options.quiet) {
    emit(`$ ${argv.map(quote).join(" ")}`);
    if (result.stdout.trim() !== "") emit(clip(result.stdout.replace(/\s+$/, "")));
    if (result.stderr.trim() !== "") emit(clip(result.stderr.replace(/\s+$/, "")));
    const outcome = result.timedOut
      ? `TIMEOUT after ${Math.round(result.durationMs / 1000)}s`
      : result.missing
        ? "NOT FOUND"
        : `exit ${result.status ?? "null"}${result.signal === null ? "" : ` (signal ${result.signal})`}`;
    emit(`[${outcome}, ${(result.durationMs / 1000).toFixed(1)}s]`);
  }
  return result;
};

/** `sbx <argv>` with the binary from $SBX or PATH. */
const sbx = (argv: ReadonlyArray<string>, timeoutMs = 120_000): RunResult =>
  run([SBX, ...argv], { timeoutMs });

/**
 * Remove the scratch sandbox. The single choke point for `sbx rm`.
 *
 * The assertion is not decoration: it is the reason this script can be handed
 * to a human with "it only touches t3ck-probe" and have that be true by
 * construction rather than by review.
 */
const destroy = (reason: string): RunResult => {
  if (SCRATCH !== "t3ck-probe") {
    throw new Error(`refusing to remove '${SCRATCH}': the probe may only remove 't3ck-probe'`);
  }
  note(`removing the scratch sandbox only (${reason})`);
  return sbx(["rm", "--force", SCRATCH], 300_000);
};

/** True when `sbx ls` lists a sandbox by exactly this name. */
const listed = (listing: string, name: string): boolean =>
  listing.split(/\r?\n/).some((line) => line.split(/\s+/).some((token) => token === name));

// ── in-sandbox probes ───────────────────────────────────────────────────────

type Marker = "present" | "missing" | "nodir" | "unknown";

interface Snapshot {
  readonly phase: string;
  readonly markers: Readonly<Record<string, Marker>>;
  readonly init: Readonly<Record<string, string>>;
  readonly mounts: ReadonlyArray<string>;
  readonly reached: boolean;
}

const execInSandbox = (script: string, timeoutMs = 120_000): RunResult =>
  sbx(["exec", SCRATCH, "--", "sh", "-c", script], timeoutMs);

/** Drop one marker per volume, carrying the run id and the volume's own name. */
const writeMarkers = (): void => {
  const script = VOLUMES.map(
    (volume) =>
      `if printf '%s' '${RUN_ID}:${volume.name}' > '${volume.path}/${MARKER}' 2>/dev/null; then ` +
      `printf 'WROTE ${volume.name}\\n'; else printf 'WRITE-FAILED ${volume.name}\\n'; fi`,
  ).join("\n");
  execInSandbox(script);
};

/**
 * Read every marker, plus the two pieces of evidence that say whether a volume
 * is the *same* volume: the `.sbx-volume-initialized` timestamp (the signal #16
 * used) and the device each mount point is backed by. A changed device or a
 * fresh init timestamp means the volume was recreated even if a marker somehow
 * came back.
 */
const readState = (phase: string): Snapshot => {
  banner(`state: ${phase}`);
  const lines: string[] = [];
  for (const volume of VOLUMES) {
    lines.push(
      `if [ -d '${volume.path}' ]; then`,
      `  if [ -f '${volume.path}/${MARKER}' ]; then`,
      `    printf 'MARKER ${volume.name} present %s\\n' "$(cat '${volume.path}/${MARKER}' 2>/dev/null)"`,
      `  else`,
      `    printf 'MARKER ${volume.name} missing\\n'`,
      `  fi`,
      `  printf 'INIT ${volume.name} %s\\n' "$(stat -c %y '${volume.path}/.sbx-volume-initialized' 2>/dev/null || echo none)"`,
      `else`,
      `  printf 'MARKER ${volume.name} nodir\\n'`,
      `fi`,
    );
  }
  lines.push(
    `printf 'MOUNTS-BEGIN\\n'`,
    `grep -E ' /home/agent/(workspace|\\.t3/)' /proc/mounts || echo 'no volume mount matched'`,
    `printf 'MOUNTS-END\\n'`,
  );

  const result = execInSandbox(lines.join("\n"));
  const reached = result.status === 0 && !result.timedOut;
  if (!reached) {
    note(
      "could not read state: the exec above did not succeed, so every cell here is 'could not determine'",
    );
  }

  const markers: Record<string, Marker> = {};
  const init: Record<string, string> = {};
  const mounts: string[] = [];
  let inMounts = false;

  for (const raw of result.stdout.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "MOUNTS-BEGIN") {
      inMounts = true;
      continue;
    }
    if (line === "MOUNTS-END") {
      inMounts = false;
      continue;
    }
    if (inMounts) {
      if (line !== "") mounts.push(line);
      continue;
    }
    const marker = /^MARKER (\S+) (present|missing|nodir)(?:\s+(.*))?$/.exec(line);
    if (marker?.[1] !== undefined && marker[2] !== undefined) {
      markers[marker[1]] = marker[2] as Marker;
      continue;
    }
    const stamp = /^INIT (\S+) (.*)$/.exec(line);
    if (stamp?.[1] !== undefined && stamp[2] !== undefined) init[stamp[1]] = stamp[2];
  }

  if (!reached) {
    for (const volume of VOLUMES) markers[volume.name] = "unknown";
  }

  return { phase, markers, init, mounts, reached };
};

/** Poll `sbx exec` until the sandbox answers, the way the CLI waits for readiness. */
const waitForExec = (timeoutMs = 180_000): boolean => {
  const deadline = Date.now() + timeoutMs;
  let attempt = 0;
  while (Date.now() < deadline) {
    attempt += 1;
    const result = spawn([SBX, "exec", SCRATCH, "--", "true"], 30_000);
    if (result.status === 0) {
      note(`sandbox answers 'sbx exec' after ${attempt} attempt(s)`);
      return true;
    }
    // No sleep helper: this runs on the host once, and a busy wait would burn a
    // core for minutes. Atomics.wait on a shared buffer is the portable sleep.
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 3_000);
  }
  note(`sandbox did not answer 'sbx exec' within ${Math.round(timeoutMs / 1000)}s`);
  return false;
};

/** `create` + `run`, the CLI's two-step, timed so the log shows the build cost. */
const createAndStart = (label: string): boolean => {
  banner(`create + start (${label})`);
  note("first create builds the kit image; later ones reuse the cached image");
  const created = sbx(
    ["create", "--name", SCRATCH, "-p", `127.0.0.1:${PORT}:${CONTAINER_PORT}`, KIT],
    1_800_000,
  );
  if (created.status !== 0) {
    note("create failed; nothing further can be probed in this phase");
    return false;
  }
  const started = sbx(["run", "-d", "--name", SCRATCH], 600_000);
  if (started.status !== 0) {
    note("run failed; nothing further can be probed in this phase");
    return false;
  }
  return waitForExec();
};

// ── host-side inventory ─────────────────────────────────────────────────────

/**
 * Read-only listing of the host directories sbx might keep sandbox state in.
 *
 * This answers "is there a per-volume artifact on the host at all?" — which is
 * what decides whether a local purge is even conceivable. It lists names, sizes
 * and mtimes only; it never opens a file, and it names `credentials.yaml`
 * explicitly so the log shows it was seen and skipped rather than missed.
 */
const hostInventory = (): void => {
  banner("host-side sbx state (read-only listing; no file is opened)");
  const home = os.homedir();
  const candidates =
    process.platform === "win32"
      ? [
          process.env.LOCALAPPDATA === undefined ? null : join(process.env.LOCALAPPDATA, "sbx"),
          process.env.APPDATA === undefined ? null : join(process.env.APPDATA, "sbx"),
          join(home, ".sbx"),
        ]
      : [join(home, ".sbx"), join(home, ".local", "share", "sbx"), join(home, ".config", "sbx")];

  const found = candidates.filter((path): path is string => path !== null && existsSync(path));
  if (found.length === 0) {
    note(`no sbx state directory found in: ${candidates.filter((c) => c !== null).join(", ")}`);
    note("that is itself an answer: volumes have no host-side per-volume artifact to purge");
    return;
  }

  for (const dir of found) {
    emit(`$ ls ${dir}`);
    let entries: string[];
    try {
      entries = readdirSync(dir).toSorted();
    } catch (error) {
      emit(`[could not list: ${String(error)}]`);
      continue;
    }
    if (entries.length === 0) {
      emit("(empty)");
      continue;
    }
    for (const entry of entries.slice(0, 100)) {
      if (entry.toLowerCase() === "credentials.yaml") {
        emit("  credentials.yaml  [not read: credential material]");
        continue;
      }
      try {
        const stat = statSync(join(dir, entry));
        const kind = stat.isDirectory() ? "dir " : "file";
        emit(`  ${kind} ${entry}  ${stat.size}B  ${stat.mtime.toISOString()}`);
      } catch {
        emit(`  ?    ${entry}  [stat failed]`);
      }
    }
    if (entries.length > 100) emit(`  …[${entries.length - 100} more entries]`);
  }
};

// ── how sbx resolves on this host ───────────────────────────────────────────

interface SbxIdentity {
  readonly version: string;
  readonly kind: string;
  readonly source: string;
}

/**
 * Classify the `sbx` entry point. This is the one question in #30 that decides
 * whether `packages/sbx/src/resolve.ts` needs the escaped-command-line branch
 * from t3code's `shell.ts`: a `.cmd`/`.bat` shim needs it, a real `.exe` does
 * not.
 */
const classifySbx = (raw: string): { kind: string; source: string } => {
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "");
  const source =
    lines.find((line) => /\.(exe|cmd|bat|ps1)\b/i.test(line)) ??
    lines.find((line) => /^[A-Za-z]:\\/.test(line)) ??
    lines[0] ??
    "";
  const lowered = source.toLowerCase();
  if (lowered.endsWith(".cmd") || /\.cmd\b/.test(lowered))
    return { kind: "cmd shim (.cmd)", source };
  if (lowered.endsWith(".bat") || /\.bat\b/.test(lowered))
    return { kind: "bat shim (.bat)", source };
  if (lowered.endsWith(".ps1") || /\.ps1\b/.test(lowered))
    return { kind: "PowerShell shim (.ps1)", source };
  if (lowered.endsWith(".exe") || /\.exe\b/.test(lowered))
    return { kind: "real executable (.exe)", source };
  if (/application/.test(raw.toLowerCase()))
    return { kind: "application (see raw output)", source };
  // No extension at all: a plain executable, which spawns from argv the same way
  // a .exe does. Windows almost never does this; POSIX almost always does.
  const base = source.split(/[\\/]/).pop() ?? "";
  if (base !== "" && !base.includes("."))
    return { kind: "extensionless executable (no shim)", source };
  return { kind: "could not determine", source };
};

const probeIdentity = (): SbxIdentity => {
  banner("identity: version, host, and what `sbx` actually is");
  emit(`host os: ${os.version()} (${os.release()}, ${process.platform}/${os.arch()})`);
  emit(`node: ${process.version}`);
  emit(`SBX env override: ${process.env.SBX === undefined ? "(unset)" : process.env.SBX}`);
  emit(`kit dir passed to create: ${KIT}`);
  emit(`scratch sandbox: ${SCRATCH}   host port: ${PORT}`);

  const version = sbx(["version"], 60_000);
  const firstLine = (version.stdout || version.stderr).trim().split(/\r?\n/)[0] ?? "";
  const versionText = firstLine === "" ? "could not determine" : firstLine;

  banner("where sbx comes from (the .cmd/.exe question)");
  const whereExe = run(["where.exe", "sbx"], { timeoutMs: 60_000 });
  const getCommand = run(
    [
      process.platform === "win32" ? "powershell" : "sh",
      ...(process.platform === "win32"
        ? [
            "-NoProfile",
            "-Command",
            "Get-Command sbx | Select-Object CommandType,Source,Version | Format-List",
          ]
        : ["-c", "command -v sbx"]),
    ],
    { timeoutMs: 60_000 },
  );

  const combined = `${whereExe.stdout}\n${whereExe.stderr}\n${getCommand.stdout}\n${getCommand.stderr}`;
  const classified = classifySbx(combined);
  emit("");
  emit(`RESOLVED: ${classified.kind}`);
  emit(`SOURCE:   ${classified.source === "" ? "(could not determine)" : classified.source}`);
  note(
    "a .cmd/.bat here means resolve.ts needs the escaped-command-line branch; a .exe means argv is enough",
  );

  return { version: versionText, kind: classified.kind, source: classified.source };
};

// ── help texts ──────────────────────────────────────────────────────────────

interface HelpFacts {
  readonly purgeFlags: ReadonlyArray<string>;
  readonly localVolumeLs: RunResult;
  readonly cloudVolumeLs: RunResult;
}

const probeHelp = (): HelpFacts => {
  banner("help texts: what the verbs and flags actually are");
  note("captured before anything is created, so the flags are known before they are used");

  sbx(["--help"], 60_000);
  const rmHelp = sbx(["rm", "--help"], 60_000);
  sbx(["create", "--help"], 60_000);
  sbx(["stop", "--help"], 60_000);
  sbx(["ls", "--help"], 60_000);
  sbx(["exec", "--help"], 60_000);
  sbx(["volume", "--help"], 60_000);
  sbx(["--cloud", "volume", "--help"], 60_000);

  banner("local vs cloud volume commands");
  const localVolumeLs = sbx(["volume", "ls"], 60_000);
  const cloudVolumeLs = sbx(["--cloud", "volume", "ls"], 60_000);
  sbx(["volume", "rm", "--help"], 60_000);

  const purgeFlags = ["--purge", "--volumes", "--volume", "--prune", "--keep-volumes"].filter(
    (flag) => rmHelp.stdout.includes(flag),
  );
  emit("");
  emit(`PURGE FLAGS ON rm: ${purgeFlags.length === 0 ? "none found" : purgeFlags.join(", ")}`);
  emit(
    `LOCAL 'volume ls': ${localVolumeLs.status === 0 ? "works" : `fails (exit ${localVolumeLs.status ?? "null"})`}`,
  );
  note(
    "'none found' means a local purge has no documented flag; the recreate in phase 4 is then the only observable",
  );
  return { purgeFlags, localVolumeLs, cloudVolumeLs };
};

// ── the phases ──────────────────────────────────────────────────────────────

const main = async (): Promise<void> => {
  banner("probe: local sbx capabilities and volume lifecycle (#30)");
  emit(`run id: ${RUN_ID}`);
  emit(`started: ${new Date().toISOString()}`);
  emit("");
  emit("SAFETY: this probe creates and destroys exactly one sandbox, 't3ck-probe'.");
  emit("        It never removes any other sandbox or volume, and never reads");
  emit("        %APPDATA%\\sbx\\credentials.yaml. It does not run 'sbx secret ls'.");
  emit("COST:   the first create builds the kit image (~5-20 min cold). Later");
  emit("        creates reuse the cached image. Expect ~10-25 min cold, ~3-6 warm.");

  const identity = probeIdentity();

  const preflight = sbx(["ls"], 120_000);
  if (preflight.missing) {
    emit("");
    emit("sbx was not found on PATH. Install it, or set SBX to its full path, and re-run.");
    writeReport();
    process.exitCode = 1;
    return;
  }
  if (listed(preflight.stdout, SCRATCH)) {
    emit("");
    emit(
      `A sandbox named '${SCRATCH}' already exists, and this probe only removes sandboxes it created.`,
    );
    emit("Remove it yourself first, then re-run:");
    emit("");
    emit(`    sbx rm --force ${SCRATCH}`);
    emit("");
    writeReport();
    process.exitCode = 1;
    return;
  }
  note(`preflight: no sandbox named '${SCRATCH}' exists, so anything created below is ours`);

  if (!PROBE_YES) {
    if (!process.stdin.isTTY) {
      emit("");
      emit("stdin is not a TTY. Re-run with PROBE_YES=1 to skip the confirmation prompt.");
      writeReport();
      process.exitCode = 1;
      return;
    }
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question(`\nType "${SCRATCH}" to create and destroy it: `);
    rl.close();
    if (answer.trim() !== SCRATCH) {
      emit("not confirmed; nothing was created or removed.");
      writeReport();
      process.exitCode = 1;
      return;
    }
  }

  const help = probeHelp();

  // ── phase 1: build once ───────────────────────────────────────────────────
  const created = createAndStart("the one image build");
  const snapshots: Snapshot[] = [];
  if (!created) {
    emit("");
    emit("The first create/start failed, so no volume scenario can be observed.");
    emit("Cleaning up the scratch sandbox in case create succeeded and only start did not.");
    hostInventory();
    // A half-built sandbox is still ours, so it is still ours to remove. If
    // create failed outright this is a harmless "no such sandbox" above.
    destroy("create/start failed");
    writeReport();
    process.exitCode = 1;
    return;
  }

  banner("does create refuse a name that already exists?");
  note("cheap, fails fast, and it is the SandboxExistsError branch the seam needs");
  sbx(["create", "--name", SCRATCH, "-p", `127.0.0.1:${PORT}:${CONTAINER_PORT}`, KIT], 120_000);

  banner("listing shapes");
  sbx(["ls"], 120_000);
  sbx(["ls", "--all"], 120_000);
  sbx(["ports", SCRATCH], 60_000);

  banner("write the markers");
  writeMarkers();
  snapshots.push(readState("created (baseline)"));

  // ── phase 2: stop + start ─────────────────────────────────────────────────
  banner("scenario 1: stop, then start");
  sbx(["stop", SCRATCH], 300_000);
  banner("exec against a stopped sandbox (the SandboxNotFoundError branch)");
  sbx(["exec", SCRATCH, "--", "true"], 60_000);
  const restarted = sbx(["run", "-d", "--name", SCRATCH], 600_000);
  if (restarted.status === 0) waitForExec();
  snapshots.push(readState("after stop + start"));

  // ── phase 3: rm --force, inventory, recreate ──────────────────────────────
  banner("scenario 2: rm --force, then create the same name again");
  note("this is `rebuild`'s sequence in the v2 CLI");
  destroy("scenario 2");
  banner("scenario 3: after rm --force alone, is the volume still visible anywhere?");
  sbx(["ls"], 120_000);
  sbx(["volume", "ls"], 60_000);
  sbx(["--cloud", "volume", "ls"], 60_000);
  hostInventory();
  if (createAndStart("after rm --force")) {
    snapshots.push(readState("after rm + recreate"));
  } else {
    snapshots.push({
      phase: "after rm + recreate",
      markers: {},
      init: {},
      mounts: [],
      reached: false,
    });
  }

  // ── phase 4: nuke ─────────────────────────────────────────────────────────
  banner("scenario 4: the retired launcher's nuke (rm --force, then the volume loop)");
  note("the pre-ADR-0003 sequence: rm --force, list volumes, remove each match by name");
  destroy("nuke, step 1");
  const volumeListing = sbx(["volume", "ls"], 60_000);
  const matched = volumeListing.stdout
    .split(/\r?\n/)
    .map((line) => line.trim().split(/\s+/)[0] ?? "")
    .filter((name) => name !== "" && name.includes(SCRATCH));
  if (matched.length === 0) {
    note(
      `no volume name matched '${SCRATCH}' in the local listing (exit ${volumeListing.status ?? "null"})`,
    );
  }
  for (const volume of matched) {
    if (!volume.includes(SCRATCH)) {
      throw new Error(`refusing to remove volume '${volume}': it does not name ${SCRATCH}`);
    }
    sbx(["volume", "rm", volume], 120_000);
  }
  banner("after nuke, before recreating: what remains?");
  sbx(["ls"], 120_000);
  sbx(["volume", "ls"], 60_000);
  hostInventory();
  if (createAndStart("after nuke")) {
    snapshots.push(readState("after nuke + recreate"));
  } else {
    snapshots.push({
      phase: "after nuke + recreate",
      markers: {},
      init: {},
      mounts: [],
      reached: false,
    });
  }

  // ── phase 5: non-TTY exec (#24) ───────────────────────────────────────────
  banner("non-TTY `sbx exec` (#24)");
  execInSandbox(
    "if [ -t 0 ]; then echo stdin-tty; else echo stdin-notty; fi; " +
      "if [ -t 1 ]; then echo stdout-tty; else echo stdout-notty; fi",
  );
  execInSandbox("echo plain-exec-works");
  if (PROBE_PI) {
    note("pi round-trip, bounded at 90s: a hang here is a finding, not a probe bug");
    note("spends real model tokens; PROBE_PI=0 skips it");
    const pi = sbx(
      ["exec", SCRATCH, "--", "pi", "-p", "Reply with exactly: OK", "--no-tools", "--no-session"],
      90_000,
    );
    emit("");
    emit(
      pi.timedOut
        ? `PI VERDICT: hung — killed after ${Math.round(pi.durationMs / 1000)}s under a non-TTY exec`
        : `PI VERDICT: returned, exit ${pi.status ?? "null"} after ${(pi.durationMs / 1000).toFixed(1)}s`,
    );
  } else {
    note("pi round-trip skipped (PROBE_PI=0)");
  }

  // ── teardown ──────────────────────────────────────────────────────────────
  banner("teardown");
  destroy("end of probe");
  sbx(["ls"], 120_000);
  hostInventory();

  printMatrix(snapshots, help);
  printSummary(identity, help);
  writeReport();
};

// ── derived output ──────────────────────────────────────────────────────────

/**
 * The matrix, derived only from markers this run wrote and read.
 *
 * It is printed so the human does not have to interpret the log, but it is
 * labelled as derived: the ticket's matrix is taken from the raw output above,
 * and a phase that could not be read stays "could not determine".
 */
const printMatrix = (snapshots: ReadonlyArray<Snapshot>, help: HelpFacts): void => {
  banner("DERIVED MATRIX (from the marker reads above; confirm against the raw output)");
  const columns = ["created", "after stop + start", "after rm + recreate", "after nuke + recreate"];
  const cell = (snapshot: Snapshot | undefined, volume: string): string => {
    if (snapshot === undefined) return "could not determine";
    const marker = snapshot.markers[volume];
    if (marker === undefined || marker === "unknown") return "could not determine";
    if (marker === "present") return "survives";
    if (marker === "missing") return "gone";
    return "no such dir";
  };

  emit(`volume      ${columns.map((c) => c.padEnd(22)).join("")}`);
  for (const volume of VOLUMES) {
    const cells = snapshots.map((snapshot) => cell(snapshot, volume.name).padEnd(22)).join("");
    emit(`${volume.name.padEnd(12)}${cells}`);
  }
  emit("");
  const purge =
    help.purgeFlags.length > 0
      ? `maybe — rm --help documents ${help.purgeFlags.join(", ")} (verify by hand)`
      : help.localVolumeLs.status === 0
        ? "via `sbx volume rm` (the local listing works)"
        : "no — `sbx volume` is cloud-only locally and rm documents no purge flag";
  emit(`purgeable locally: ${purge}`);
  note("purge is an instance-level property in every observation, not a per-volume one:");
  note("no local verb takes a volume name, so 'purgeable' is all-or-nothing for the four volumes");
  note(
    "a marker that survived but whose INIT timestamp or mount device changed is a new volume with old data",
  );

  banner("volume identity evidence (INIT timestamp + backing device, per phase)");
  for (const snapshot of snapshots) {
    emit(`-- ${snapshot.phase}${snapshot.reached ? "" : " (NOT REACHED)"}`);
    for (const volume of VOLUMES) {
      emit(`   ${volume.name.padEnd(10)} init=${snapshot.init[volume.name] ?? "?"}`);
    }
    for (const mount of snapshot.mounts) emit(`   mount ${mount}`);
  }
};

const printSummary = (identity: SbxIdentity, help: HelpFacts): void => {
  banner("SUMMARY (the three facts the ticket asks for first)");
  emit(`sbx version:  ${identity.version}`);
  emit(`host os:       ${os.version()} (${process.platform}/${os.arch()})`);
  emit(
    `sbx resolves:  ${identity.kind} — ${identity.source === "" ? "source unknown" : identity.source}`,
  );
  emit(`rm purge flag: ${help.purgeFlags.length > 0 ? help.purgeFlags.join(", ") : "none found"}`);
  emit(
    `local volume:  ${help.localVolumeLs.status === 0 ? "sbx volume ls works" : "sbx volume is cloud-only"}`,
  );
  emit("");
  emit("Anything above that says 'could not determine' is a real answer: it means the");
  emit("command did not produce evidence, and the matrix cell stays open.");
};

const writeReport = (): void => {
  const stamp = new Date().toISOString().replaceAll(/[:.]/g, "-");
  const path = resolve(process.cwd(), `probe-sbx-${stamp}.log`);
  try {
    writeFileSync(path, `${report.join("\n")}\n`, "utf8");
    process.stdout.write(`\nreport written to ${path}\n`);
  } catch (error) {
    process.stdout.write(`\ncould not write the report file: ${String(error)}\n`);
  }
};

await main();
