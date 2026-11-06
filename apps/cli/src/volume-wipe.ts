// The wipe: destroy a sandbox instance's volume contents from inside it.
//
// `nuke` owns the confirmation and the removal; this module owns the part that
// must not be forgotten: kill the writers, mark the volumes, delete every
// entry, verify the markers are gone, and retry once before reporting failure.
// It returns an outcome rather than failing, so the verb chooses the sentence
// and the exit code. The volume objects are not touched; `sbx` has no local
// per-sandbox purge (ADR 0003).
import * as Effect from "effect/Effect";

import { VOLUME_PATHS } from "@t3ck/kit/Volumes";
import { Sbx, type ExecResult, type SbxError } from "@t3ck/sbx/Sbx";

import { warn } from "./cli.ts";

/** A wipe is bounded: `sbx exec` may start a stopped sandbox first, and a
 * large workspace can take a while to delete. Five minutes is long enough for
 * both and short enough that a wedged exec fails instead of hanging. */
const NUKE_TIMEOUT_MS = 5 * 60_000;

/** Quote one word for the in-sandbox shell. This is not `command.render`,
 * which is for logs and tests and must never be passed to a shell. */
const shellQuote = (word: string): string => `'${word.replaceAll("'", `'\\''`)}'`;

/** The marker the wipe writes before deleting and checks afterwards. It is
 * deliberately not a volume path: `serve.sh` can start `t3 serve` after the
 * wipe and write fresh state into `.t3/userdata`, so "the directory is empty"
 * is the wrong question. "The marker is gone" is the right one: the wipe's
 * `find -delete` exits 0 only after deleting every entry, including this one. */
const NUKE_MARKER = ".t3ck-nuke-marker";

const markerScript = [
  "set -e",
  ...VOLUME_PATHS.map((path) => `printf '%s\\n' 'nuke' > ${shellQuote(path)}/${NUKE_MARKER}`),
].join("\n");

// One `sh -c` script, passed as one argv element through the exec seam. `sbx
// exec` starts a stopped sandbox, which runs the lifecycle hook and starts
// `t3 serve`, so the kill is not optional: without it the wipe races a live
// SQLite writer. `find -delete` rather than `rm -rf dir/*`, which misses
// dotfiles. The `[b]in/pi` bracket keeps the pattern from matching this
// script's own command line.
const wipeScript = [
  "set -e",
  "pkill -f '^t3 serve' 2>/dev/null || true",
  "pkill -x pi 2>/dev/null || true",
  "pkill -f '[b]in/pi( |$)' 2>/dev/null || true",
  ...VOLUME_PATHS.map((path) => `find ${shellQuote(path)} -mindepth 1 -delete`),
  // The verify below runs in the same mount, so it sees the deletions whether
  // or not they have reached the disk. `sbx rm --force` follows within
  // seconds, and a volume whose last unflushed changes never made it out
  // reattaches with the data still there - the one outcome ADR 0003 says must
  // not happen. `sync` is what makes the wipe's promise durable.
  "sync",
].join("\n");

const verifyScript = [
  "set -e",
  ...VOLUME_PATHS.map(
    (path) =>
      `[ ! -e ${shellQuote(path)}/${NUKE_MARKER} ] || printf '%s\\n' ${shellQuote(path)}/${NUKE_MARKER}`,
  ),
].join("\n");

export type WipeOutcome =
  | { readonly kind: "clean" }
  | { readonly kind: "missing" }
  | { readonly kind: "dirty"; readonly detail: string };

type StepOutcome =
  | { readonly kind: "missing" }
  | { readonly kind: "dirty"; readonly detail: string }
  | { readonly kind: "ok"; readonly result: ExecResult };

const dirtyFromError = (error: SbxError): Effect.Effect<StepOutcome> =>
  Effect.succeed({ kind: "dirty" as const, detail: error.message });

const runWipeStep = (
  name: string,
  script: string,
  label: string,
  user?: string,
): Effect.Effect<StepOutcome, never, Sbx> =>
  Effect.gen(function* () {
    const sbx = yield* Sbx;
    const result = yield* sbx
      .exec({
        name,
        argv: ["sh", "-c", script],
        timeoutMs: NUKE_TIMEOUT_MS,
        ...(user === undefined ? {} : { user }),
      })
      .pipe(
        Effect.catchTags({
          SandboxMissingError: () => Effect.succeed({ kind: "missing" as const }),
          SbxCommandError: dirtyFromError,
          SbxTimeoutError: dirtyFromError,
          SbxNotFoundError: dirtyFromError,
        }),
      );
    if ("kind" in result) return result;
    if (result.exitCode !== 0) {
      return {
        kind: "dirty" as const,
        detail: result.stderr.trim() || `${label} exited ${result.exitCode}`,
      };
    }
    return { kind: "ok" as const, result };
  });

const wipeOnce = (name: string): Effect.Effect<WipeOutcome, never, Sbx> =>
  Effect.gen(function* () {
    const marker = yield* runWipeStep(name, markerScript, "marker");
    if (marker.kind !== "ok") return marker;
    // Root, because the volume's `.sbx-volume-initialized` stamp and ext4's
    // `lost+found` are root-owned; as the agent user `find -delete` aborts on
    // them and the wipe can never verify.
    const wipe = yield* runWipeStep(name, wipeScript, "wipe", "root");
    if (wipe.kind !== "ok") return wipe;
    const verify = yield* runWipeStep(name, verifyScript, "verify");
    if (verify.kind !== "ok") return verify;
    const survivors = verify.result.stdout.trim();
    return survivors.length === 0
      ? { kind: "clean" as const }
      : { kind: "dirty" as const, detail: `surviving markers: ${survivors}` };
  });

/** Wipe every volume's contents, retrying once. A `dirty` outcome carries the
 * detail the verb prints; this module never decides the exit code. */
export const wipeVolumeContents = (name: string): Effect.Effect<WipeOutcome, never, Sbx> =>
  Effect.gen(function* () {
    const first = yield* wipeOnce(name);
    if (first.kind !== "dirty") return first;
    yield* warn(`wipe of '${name}' left data behind; retrying once`);
    return yield* wipeOnce(name);
  });
