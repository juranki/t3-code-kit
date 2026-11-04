// Every host fact the kit is allowed to read, as a Context.Reference with a
// default. Production code reads `yield* HostProcess.Platform` and gets the real
// value with no layer; a test provides the reference instead of monkey-patching
// `process`, which is what makes `resolveSbxBinary` testable at all.
//
// The one write is `setExitCode`: the CLI entry sets the code the shell sees, and
// keeping that here is what lets every other module stay free of `process`.
//
// Transcribed from t3code's packages/shared/src/HostProcess.ts, trimmed to what
// a `sbx` launcher reads. Keep the reference names identical to upstream so the
// `nodeBuiltinImport` exemption in tsconfig.json reads the same as theirs.
//
// t3code is MIT-licensed, Copyright (c) 2026 T3 Tools Inc. The notice for this
// transcription is reproduced in THIRD-PARTY-NOTICES.md at the repo root, which
// is what the licence asks be carried with a substantial portion of the work.
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as NodeOS from "node:os";

export const Platform = Context.Reference<NodeJS.Platform>("@t3ck/host/HostProcess/Platform", {
  defaultValue: () => process.platform,
});

export const Architecture = Context.Reference<NodeJS.Architecture>(
  "@t3ck/host/HostProcess/Architecture",
  { defaultValue: () => process.arch },
);

export const Environment = Context.Reference<NodeJS.ProcessEnv>(
  "@t3ck/host/HostProcess/Environment",
  { defaultValue: () => process.env },
);

export const HomeDirectory = Context.Reference<string>("@t3ck/host/HostProcess/HomeDirectory", {
  defaultValue: () => NodeOS.homedir(),
});

export const WorkingDirectory = Context.Reference<string>(
  "@t3ck/host/HostProcess/WorkingDirectory",
  { defaultValue: () => process.cwd() },
);

export const ExecutablePath = Context.Reference<string>("@t3ck/host/HostProcess/ExecutablePath", {
  defaultValue: () => process.execPath,
});

export const Arguments = Context.Reference<ReadonlyArray<string>>(
  "@t3ck/host/HostProcess/Arguments",
  { defaultValue: () => process.argv },
);

/** Whether stdin is a terminal. `nuke` prompts only when it is; a non-TTY must
 * pass `--yes`, so a script cannot wipe a sandbox by accident. */
export const StdinIsTTY = Context.Reference<boolean>("@t3ck/host/HostProcess/StdinIsTTY", {
  defaultValue: () => process.stdin.isTTY ?? false,
});

export const isWindows = Effect.map(Platform, (platform) => platform === "win32");

/** The code the shell sees when the CLI exits. */
export const setExitCode = (code: number): Effect.Effect<void> =>
  Effect.sync(() => {
    process.exitCode = code;
  });
