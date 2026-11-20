// Durability acceptance owns the ADR 0003 checks: `rebuild` retention, `nuke`
// refusal without `--yes`, `nuke` wipe + volume-object retention, and `nuke` on
// a missing sandbox instance. Smoke supplies the sandbox name, timeouts, and
// CLI runner, then prints the ordered results and updates its lifecycle state.
import { VOLUME_PATHS } from "@t3ck/kit/Volumes";
import { Sbx, type ExecResult } from "@t3ck/sbx/Sbx";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";

export type DurabilitySandboxState = "running" | "nuked" | "gone";

export interface DurabilityCheckResult {
  readonly status: "pass" | "fail" | "skip";
  readonly label: string;
  /** Captured CLI output when a verb failed non-zero, for smoke to print. */
  readonly output?: ExecResult;
}

export interface DurabilityResult {
  readonly checks: ReadonlyArray<DurabilityCheckResult>;
  readonly state: DurabilitySandboxState;
}

export type CliRunner = (
  args: ReadonlyArray<string>,
  timeoutMs: number,
) => Effect.Effect<ExecResult, { readonly message: string }>;

const MARKER = ".smoke-marker";
const MARKER_TEXT = "smoke-durability-marker";
/** Entries the runtime or ext4 owns, not durable state: `sbx` recreates its
 * init stamp when a volume reattaches, and a reinitialized ext4 volume gets
 * `lost+found` back. */
const VOLUME_METADATA = [".sbx-volume-initialized", "lost+found"] as const;

/** Write the durability marker into every path, then flush it to disk.
 *
 * `set -e` makes a failed write fail the whole probe rather than leaving a
 * volume unmarked. `sync` is load-bearing: both callers destroy the instance
 * within a second of writing (that is what the check is about), and a volume
 * whose last few seconds of metadata never reached the disk reattaches without
 * the marker. Without the flush this measures write-back timing, not
 * retention. */
const writeMarkerScript = (paths: ReadonlyArray<string>): string =>
  [
    "set -e",
    ...paths.map((volumePath) => `printf '%s\\n' '${MARKER_TEXT}' > ${volumePath}/${MARKER}`),
    "sync",
  ].join("\n");

/** Read the markers back, one `present <path>` or `missing <path>` line each.
 * A missing marker is not an error: its absence is exactly what the nuke check
 * is looking for. Naming the path is what makes a failure attributable. */
const readMarkerScript = (paths: ReadonlyArray<string>): string =>
  [
    "set -e",
    ...paths.map(
      (volumePath) =>
        `if [ -f ${volumePath}/${MARKER} ]; then printf 'present %s\\n' ${volumePath}; else printf 'missing %s\\n' ${volumePath}; fi`,
    ),
  ].join("\n");

const markerPaths = (stdout: string, status: "present" | "missing"): ReadonlyArray<string> =>
  stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.startsWith(`${status} `))
    .map((line) => line.slice(`${status} `.length));

const markerCount = (stdout: string): number => markerPaths(stdout, "present").length;

/** Parse `printf '%s ' <path>; stat -c '%d' <path>` lines into path -> device. */
const parseDevices = (stdout: string): Record<string, string> => {
  const devices: Record<string, string> = {};
  for (const line of stdout.split(/\r?\n/u)) {
    const [volumePath, device] = line.trim().split(/\s+/u);
    if (volumePath !== undefined && device !== undefined) devices[volumePath] = device;
  }
  return devices;
};

const detailOf = (
  result: Result.Result<{ readonly exitCode: number }, { readonly message: string }>,
): string =>
  Result.isFailure(result) ? result.failure.message : `exit ${result.success.exitCode}`;

/** Run all four ADR 0003 durability checks and return ordered results plus the
 * sandbox instance's resulting lifecycle state. */
export const checkDurability = Effect.fn("DurabilityAcceptance.checkDurability")(function* ({
  name,
  upTimeoutMs,
  nukeTimeoutMs,
  execTimeoutMs,
  runCli,
}: {
  readonly name: string;
  readonly upTimeoutMs: number;
  readonly nukeTimeoutMs: number;
  readonly execTimeoutMs: number;
  readonly runCli: CliRunner;
}): Effect.fn.Return<DurabilityResult, never, Sbx> {
  const sbx = yield* Sbx;
  const checks: Array<DurabilityCheckResult> = [];
  let state: DurabilitySandboxState = "running";

  const add = (
    status: DurabilityCheckResult["status"],
    label: string,
    output?: ExecResult,
  ): void => {
    checks.push(output === undefined ? { status, label } : { status, label, output });
  };

  const exec = (argv: ReadonlyArray<string>, timeoutMs = execTimeoutMs) =>
    sbx.exec({ name, argv, timeoutMs });

  const sandboxExists = (): Effect.Effect<boolean> =>
    sbx.list().pipe(
      Effect.map((sandboxes) => sandboxes.some((sandbox) => sandbox.name === name)),
      Effect.orElseSucceed(() => false),
    );

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
    add("fail", `could not write the rebuild marker: ${detailOf(wroteRebuild)}`);
  } else {
    const rebuilt = yield* runCli(["rebuild", name], upTimeoutMs).pipe(Effect.result);
    if (Result.isFailure(rebuilt)) {
      add("fail", `rebuild could not run: ${rebuilt.failure.message}`);
    } else if (rebuilt.success.exitCode !== 0) {
      add("fail", `rebuild failed (exit ${rebuilt.success.exitCode})`, rebuilt.success);
    } else {
      const read = yield* exec(["sh", "-c", readMarkerScript(rebuildPaths)]).pipe(Effect.result);
      if (Result.isFailure(read) || read.success.exitCode !== 0) {
        add("fail", `could not read the rebuild marker: ${detailOf(read)}`);
      } else if (markerCount(read.success.stdout) === rebuildPaths.length) {
        add("pass", "rebuild kept the marker in .t3/userdata and workspace");
      } else {
        const lost = markerPaths(read.success.stdout, "missing").join(", ");
        add(
          "fail",
          `rebuild lost the marker in ${lost || "a volume"}: durable state did not survive`,
        );
      }
    }
  }

  if (!(yield* sandboxExists())) {
    state = "gone";
    add("fail", "sandbox is gone after rebuild; skipping the nuke checks");
    return { checks, state };
  }

  // 2. `nuke` without `--yes` on a non-TTY refuses and removes nothing.
  const refused = yield* runCli(["nuke", name], nukeTimeoutMs).pipe(Effect.result);
  if (Result.isSuccess(refused) && refused.success.exitCode !== 0) {
    if (yield* sandboxExists()) {
      add("pass", "nuke without --yes on a non-TTY refused and removed nothing");
    } else {
      add("fail", "nuke without --yes removed the sandbox");
    }
  } else {
    add(
      "fail",
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
    add("fail", `could not write the nuke marker: ${detailOf(wroteAll)}`);
  } else if (devicesBefore === undefined) {
    add("fail", "could not read the volume devices before nuke");
  } else {
    const nukedResult = yield* runCli(["nuke", name, "--yes"], nukeTimeoutMs).pipe(Effect.result);
    if (Result.isFailure(nukedResult)) {
      add("fail", `nuke could not run: ${nukedResult.failure.message}`);
    } else if (nukedResult.success.exitCode !== 0) {
      add("fail", `nuke failed (exit ${nukedResult.success.exitCode})`, nukedResult.success);
    } else {
      state = "nuked";
      add("pass", "nuke wiped the volumes and removed the instance");

      const upAgain = yield* runCli(["up", name], upTimeoutMs).pipe(Effect.result);
      if (Result.isFailure(upAgain)) {
        add("fail", `up after nuke could not run: ${upAgain.failure.message}`);
      } else if (upAgain.success.exitCode !== 0) {
        add("fail", `up after nuke failed (exit ${upAgain.success.exitCode})`, upAgain.success);
      } else {
        state = "running";

        const read = yield* exec(["sh", "-c", readMarkerScript(VOLUME_PATHS)]).pipe(Effect.result);
        if (Result.isFailure(read) || read.success.exitCode !== 0) {
          add("fail", `could not read the nuke marker: ${detailOf(read)}`);
        } else if (markerCount(read.success.stdout) === 0) {
          add("pass", "nuke left no marker in any of the four volumes");
        } else {
          const survived = markerPaths(read.success.stdout, "present").join(", ");
          add("fail", `a marker survived nuke in ${survived}: the wipe did not destroy the data`);
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
          add("pass", "workspace has no entries after nuke + up");
        } else {
          const detail = Result.isFailure(workspaceEntries)
            ? workspaceEntries.failure.message
            : workspaceEntries.success.exitCode !== 0
              ? workspaceEntries.success.stderr.trim() ||
                `exit ${workspaceEntries.success.exitCode}`
              : workspaceEntries.success.stdout.trim();
          add("fail", `workspace is not empty after nuke + up: ${detail}`);
        }

        const devicesAfter = yield* readDevices(VOLUME_PATHS);
        if (devicesAfter === undefined) {
          add("fail", "could not read the volume devices after nuke");
        } else if (
          VOLUME_PATHS.every((volumePath) => devicesBefore[volumePath] === devicesAfter[volumePath])
        ) {
          add("pass", "the four volume objects are the same (still allocated)");
        } else {
          add("fail", "the volumes changed after nuke: retention did not hold");
        }
      }
    }
  }

  // 4. `nuke` on a missing instance fails, and a second nuke removes the
  //    recreated instance.
  if (yield* sandboxExists()) {
    const finalNuke = yield* runCli(["nuke", name, "--yes"], nukeTimeoutMs).pipe(Effect.result);
    if (Result.isSuccess(finalNuke) && finalNuke.success.exitCode === 0) {
      state = "nuked";
      add("pass", "nuke removed the recreated instance");
    } else {
      add(
        "fail",
        `nuke could not remove the recreated instance (exit ${
          Result.isSuccess(finalNuke) ? finalNuke.success.exitCode : "unknown"
        })`,
      );
    }
  }

  const missing = yield* runCli(["nuke", name, "--yes"], nukeTimeoutMs).pipe(Effect.result);
  if (Result.isSuccess(missing) && missing.success.exitCode !== 0) {
    add("pass", "nuke on a missing instance exits non-zero");
  } else {
    add("fail", "nuke on a missing instance succeeded");
    state = "nuked";
  }

  return { checks, state };
});
