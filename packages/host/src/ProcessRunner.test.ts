import { describe, expect, it } from "@effect/vitest";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PlatformError from "effect/PlatformError";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import { ChildProcessSpawner } from "effect/process";

import { layer, ProcessRunner } from "./ProcessRunner.ts";

const encoder = new TextEncoder();

const handle = (exitCode: Effect.Effect<ChildProcessSpawner.ExitCode>) =>
  ChildProcessSpawner.makeHandle({
    pid: ChildProcessSpawner.ProcessId(1),
    stdout: Stream.make(encoder.encode("out")),
    stderr: Stream.empty,
    all: Stream.empty,
    exitCode,
    isRunning: Effect.succeed(false),
    kill: () => Effect.void,
    stdin: Sink.drain,
    getInputFd: () => Sink.drain,
    getOutputFd: () => Stream.empty,
    unref: Effect.succeed(Effect.void),
  });

const runWith = <A, E>(
  spawner: ChildProcessSpawner.ChildProcessSpawner["Service"],
  program: (runner: ProcessRunner["Service"]) => Effect.Effect<A, E>,
): Effect.Effect<A, E> =>
  Effect.gen(function* () {
    const runner = yield* ProcessRunner;
    return yield* program(runner);
  }).pipe(
    Effect.provide(
      layer.pipe(Layer.provide(Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, spawner))),
    ),
  );

describe("ProcessRunner", () => {
  it.live("returns stdout and a non-zero exit as data", () =>
    Effect.gen(function* () {
      const spawner = ChildProcessSpawner.make(() =>
        Effect.succeed(handle(Effect.succeed(ChildProcessSpawner.ExitCode(7)))),
      );
      const result = yield* runWith(spawner, (runner) => runner.run({ bin: "x", args: [] }));
      expect(result.exitCode).toBe(7);
      expect(result.stdout).toBe("out");
    }),
  );

  it.live("times out a bounded command", () =>
    Effect.gen(function* () {
      const spawner = ChildProcessSpawner.make(() => Effect.succeed(handle(Effect.never)));
      const error = yield* runWith(spawner, (runner) =>
        Effect.flip(runner.run({ bin: "x", args: [], timeoutMs: 10 })),
      );
      // eslint-disable-next-line no-underscore-dangle -- _tag is Effect's discriminant
      expect(error._tag).toBe("CommandTimeoutError");
    }),
  );

  it.live("does not bound an interactive command", () =>
    Effect.gen(function* () {
      const spawner = ChildProcessSpawner.make(() =>
        Effect.succeed(
          handle(
            Effect.sleep(Duration.millis(20)).pipe(Effect.as(ChildProcessSpawner.ExitCode(0))),
          ),
        ),
      );
      const result = yield* runWith(spawner, (runner) =>
        runner.run({ bin: "x", args: [], tty: true }),
      );
      expect(result.exitCode).toBe(0);
    }),
  );

  it.live("maps a not-found spawn failure to CommandNotFoundError", () =>
    Effect.gen(function* () {
      const spawner = ChildProcessSpawner.make(() =>
        Effect.fail(
          new PlatformError.PlatformError(
            new PlatformError.SystemError({
              _tag: "NotFound",
              module: "ChildProcess",
              method: "spawn",
            }),
          ),
        ),
      );
      const error = yield* runWith(spawner, (runner) =>
        Effect.flip(runner.run({ bin: "missing", args: [] })),
      );
      // eslint-disable-next-line no-underscore-dangle -- _tag is Effect's discriminant
      expect(error._tag).toBe("CommandNotFoundError");
    }),
  );
});
