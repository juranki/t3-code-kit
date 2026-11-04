import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as PlatformError from "effect/PlatformError";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import { layer, ProcessRunner } from "./ProcessRunner.ts";

const encoder = new TextEncoder();

/** The stdin a spawner was asked for, narrowed past the piped-command variant. */
const stdinOf = (command: ChildProcess.Command | undefined) =>
  command !== undefined && ChildProcess.isStandardCommand(command)
    ? command.options.stdin
    : undefined;

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

// The sleep that a timeout or a `handle` exit code waits on is registered by a
// child fiber of `Effect.all`, not by the fiber we forked. One `TestClock.adjust`
// yields once, which is not enough for that fan-out: it advances time before the
// sleep exists, the sleep then registers *after* the new "now", and the test
// hangs. Measured, not assumed — a single `adjust` fails both clock tests below.
// So yield, advance, and repeat until the fiber settles.
const advanceUntilDone = <A, E>(fiber: Fiber.Fiber<A, E>, step: Duration.Input) =>
  Effect.gen(function* () {
    for (let i = 0; i < 10; i++) {
      yield* Effect.yieldNow;
      yield* TestClock.adjust(step);
      if (fiber.pollUnsafe() !== undefined) return;
    }
  });

describe("ProcessRunner", () => {
  it.effect("returns stdout and a non-zero exit as data", () =>
    Effect.gen(function* () {
      const spawner = ChildProcessSpawner.make(() =>
        Effect.succeed(handle(Effect.succeed(ChildProcessSpawner.ExitCode(7)))),
      );
      const result = yield* runWith(spawner, (runner) => runner.run({ bin: "x", args: [] }));
      expect(result.exitCode).toBe(7);
      expect(result.stdout).toBe("out");
    }),
  );

  it.effect("times out a bounded command", () =>
    Effect.gen(function* () {
      const spawner = ChildProcessSpawner.make(() => Effect.succeed(handle(Effect.never)));
      const fiber = yield* Effect.forkChild(
        runWith(spawner, (runner) =>
          Effect.flip(runner.run({ bin: "x", args: [], timeoutMs: 10 })),
        ),
      );
      yield* advanceUntilDone(fiber, Duration.millis(10));
      const error = yield* Fiber.join(fiber);
      expect(error._tag).toBe("CommandTimeoutError");
    }),
  );

  it.effect("does not bound an interactive command", () =>
    Effect.gen(function* () {
      // Longer than the runner's 60 s default bound. If a TTY command were
      // bounded, the timeout would fire before this sleep finished.
      const spawner = ChildProcessSpawner.make(() =>
        Effect.succeed(
          handle(
            Effect.sleep(Duration.minutes(2)).pipe(Effect.as(ChildProcessSpawner.ExitCode(0))),
          ),
        ),
      );
      const fiber = yield* Effect.forkChild(
        runWith(spawner, (runner) => runner.run({ bin: "x", args: [], tty: true })),
      );
      yield* advanceUntilDone(fiber, Duration.minutes(2));
      const result = yield* Fiber.join(fiber);
      expect(result.exitCode).toBe(0);
    }),
  );

  it.effect("maps a not-found spawn failure to CommandNotFoundError", () =>
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
      expect(error._tag).toBe("CommandNotFoundError");
    }),
  );

  it.effect("gives a captured command no stdin", () =>
    Effect.gen(function* () {
      let spawned: ChildProcess.Command | undefined;
      const spawner = ChildProcessSpawner.make((command) => {
        spawned = command;
        return Effect.succeed(handle(Effect.succeed(ChildProcessSpawner.ExitCode(0))));
      });
      yield* runWith(spawner, (runner) => runner.run({ bin: "x", args: [] }));
      // The spawner's default is a pipe that this runner never writes to or
      // ends, so the child would see a stdin that never reaches EOF.
      expect(stdinOf(spawned)).toBe("ignore");
    }),
  );

  it.effect("leaves an interactive command's stdin attached", () =>
    Effect.gen(function* () {
      let spawned: ChildProcess.Command | undefined;
      const spawner = ChildProcessSpawner.make((command) => {
        spawned = command;
        return Effect.succeed(handle(Effect.succeed(ChildProcessSpawner.ExitCode(0))));
      });
      yield* runWith(spawner, (runner) => runner.run({ bin: "x", args: [], tty: true }));
      expect(stdinOf(spawned)).toBe("inherit");
    }),
  );

  // A real child, because the bug this pins was invisible to a fake: the
  // spawner's default stdin is a pipe, so a child that reads stdin to EOF (pi
  // in print mode does) waited forever. `sbx exec` forwards that pipe into the
  // sandbox, which is why the smoke's agent round-trip hung at its 120 s bound
  // while the same call from a shell answered in 2 s.
  it.effect("lets a child that reads stdin to EOF finish", () =>
    Effect.gen(function* () {
      const runner = yield* ProcessRunner;
      // The child gives itself a deadline so a regression fails in two seconds
      // instead of waiting on the runner's bound: a runner timeout cannot
      // rescue this, because closing the scope waits on the stdin pipe too.
      const result = yield* runner.run({
        bin: process.execPath,
        args: [
          "-e",
          "const t = setTimeout(() => process.exit(3), 2000);" +
            "process.stdin.resume();" +
            "process.stdin.on('end', () => { clearTimeout(t); process.exit(0); });",
        ],
      });
      expect(result.exitCode).toBe(0);
    }).pipe(Effect.provide(layer.pipe(Layer.provide(NodeServices.layer)))),
  );
});
