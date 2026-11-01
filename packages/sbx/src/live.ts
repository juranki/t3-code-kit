// The live adapter: `ProcessRunner` + `HostProcess`.
//
// This is the only file that turns the seam's commands into real processes. It
// resolves `$SBX` once, maps the runner's errors onto the seam's taxonomy, and
// probes capabilities without running anything destructive.
import * as HostProcess from "@t3ck/host/HostProcess";
import { CommandNotFoundError, CommandTimeoutError, ProcessRunner } from "@t3ck/host/ProcessRunner";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import type { Capabilities } from "./capabilities.ts";
import type { Command } from "./command.ts";
import { SbxCommandError, SbxNotFoundError, SbxTimeoutError } from "./errors.ts";
import { Sbx, make as makeSbx, type Adapter, type RawResult, type SbxError } from "./Sbx.ts";
import { bound, verbOf } from "./support.ts";

const mapProcessError = (
  error: CommandNotFoundError | CommandTimeoutError | Error,
  verb: string,
): SbxError => {
  if (Schema.is(CommandNotFoundError)(error)) {
    return new SbxNotFoundError({ searched: ["$SBX", "PATH"] });
  }
  if (Schema.is(CommandTimeoutError)(error)) {
    return new SbxTimeoutError({ verb, timeoutMs: error.timeoutMs });
  }
  return new SbxCommandError({
    verb,
    exitCode: null,
    stderr: "",
    cause: error,
  });
};

const probeCapabilities = (
  run: (input: Command) => Effect.Effect<RawResult, SbxError>,
): Effect.Effect<Capabilities, SbxError> =>
  Effect.gen(function* () {
    const version = yield* run({ bin: "sbx", args: ["version"], tty: false });
    if (version.exitCode !== 0) {
      return yield* new SbxCommandError({
        verb: "version",
        exitCode: version.exitCode,
        stderr: bound(version.stderr),
      });
    }
    // `rm --help` is the cheapest way to learn whether this build has a purge
    // flag. A failure is not fatal: the capability is reported as false.
    const rmHelp = yield* run({ bin: "sbx", args: ["rm", "--help"], tty: false }).pipe(
      Effect.orElseSucceed(() => ({ stdout: "", stderr: "", exitCode: 1 })),
    );
    return {
      mode: "local",
      version: version.stdout.trim(),
      volumes: "unsupported",
      rm: {
        force: /--force/u.test(rmHelp.stdout),
        purge: /--purge|--volumes/u.test(rmHelp.stdout),
      },
      egress: "deny-by-default",
      secrets: true,
    };
  });

export const make = Effect.gen(function* () {
  const runner = yield* ProcessRunner;
  const env = yield* HostProcess.Environment;
  const binary = env.SBX?.trim() || "sbx";

  const run = (input: Command): Effect.Effect<RawResult, SbxError> =>
    runner
      .run({ ...input, bin: binary })
      .pipe(Effect.mapError((error) => mapProcessError(error, verbOf(input))));

  return { run, capabilities: probeCapabilities(run) } satisfies Adapter;
});

export const layer: Layer.Layer<Sbx, never, ProcessRunner> = Layer.effect(
  Sbx,
  Effect.map(make, (adapter) => makeSbx(adapter)),
);
