// The one place a process is started. `sbx`, the host's `git`, and the
// readiness probe all go through this service, so argv stays an array, both
// pipes are drained concurrently, and a timeout kills the child rather than
// leaking it.
//
// This is the productionized prototype from #35's live adapter. It is a
// `Context.Service` so a test can script results without a process, and so the
// CLI can run `git`/`curl` through the same seam as `sbx`.
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PlatformError from "effect/PlatformError";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

export interface Command {
  readonly bin: string;
  readonly args: ReadonlyArray<string>;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly cwd?: string;
  /** Attach the terminal instead of capturing output. */
  readonly tty?: boolean;
  readonly timeoutMs?: number;
}

export interface Result {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

/** The binary could not be started: missing, or not executable. */
export class CommandNotFoundError extends Schema.TaggedError<CommandNotFoundError>()(
  "CommandNotFoundError",
  {
    bin: Schema.String,
  },
) {
  override get message(): string {
    return `${this.bin} was not found.`;
  }
}

/** The bounded command did not finish in time. Distinct from a non-zero exit:
 * the remedy is a larger bound, not reading stderr. */
export class CommandTimeoutError extends Schema.TaggedError<CommandTimeoutError>()(
  "CommandTimeoutError",
  {
    bin: Schema.String,
    timeoutMs: Schema.Int,
  },
) {
  override get message(): string {
    return `${this.bin} timed out after ${this.timeoutMs}ms.`;
  }
}

/** The process was spawned but its streams or exit code could not be read. */
export class CommandFailedError extends Schema.TaggedError<CommandFailedError>()(
  "CommandFailedError",
  {
    bin: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `${this.bin} could not run.`;
  }
}

export type CommandError = CommandNotFoundError | CommandTimeoutError | CommandFailedError;

export class ProcessRunner extends Context.Service<
  ProcessRunner,
  {
    readonly run: (command: Command) => Effect.Effect<Result, CommandError>;
  }
>()("@t3ck/host/ProcessRunner") {}

const DEFAULT_TIMEOUT_MS = 60_000;

const collect = <E>(stream: Stream.Stream<Uint8Array, E>): Effect.Effect<string, E> =>
  stream.pipe(
    Stream.decodeText(),
    Stream.runFold(
      () => "",
      (acc, chunk) => acc + chunk,
    ),
  );

const options = (input: Command): ChildProcess.CommandOptions => ({
  extendEnv: true,
  ...(input.env === undefined ? {} : { env: input.env }),
  ...(input.cwd === undefined ? {} : { cwd: input.cwd }),
  ...(input.tty === true
    ? { stdin: "inherit" as const, stdout: "inherit" as const, stderr: "inherit" as const }
    : // A captured command gets no stdin. The spawner's default is a pipe, and
      // nothing here ever writes to it or ends it, so the child sees a stdin
      // that never reaches EOF. A child that reads stdin to EOF - pi in print
      // mode does - then waits forever, and `sbx exec` forwards that pipe into
      // the sandbox, so the wait looks like a hang inside the sandbox. `ignore`
      // is /dev/null: EOF immediately, which is what "no input" means.
      { stdin: "ignore" as const }),
});

const isNotFound = (cause: unknown): boolean =>
  PlatformError.isPlatformError(cause) &&
  // eslint-disable-next-line no-underscore-dangle -- _tag is Effect's discriminant
  cause.reason._tag === "NotFound";

const runInScope = Effect.fn("ProcessRunner.runInScope")(function* (
  spawner: ChildProcessSpawner.ChildProcessSpawner["Service"],
  input: Command,
): Effect.fn.Return<Result, CommandError, Scope.Scope> {
  const child = yield* spawner
    .spawn(ChildProcess.make(input.bin, input.args, options(input)))
    .pipe(
      Effect.mapError((cause) =>
        isNotFound(cause)
          ? new CommandNotFoundError({ bin: input.bin })
          : new CommandFailedError({ bin: input.bin, cause }),
      ),
    );

  // Drain both pipes and the exit code concurrently. Reading stdout to
  // completion before touching stderr deadlocks when the child fills the other.
  const [stdout, stderr, exitCode] = yield* Effect.all(
    [collect(child.stdout), collect(child.stderr), child.exitCode.pipe(Effect.map(Number))],
    { concurrency: "unbounded" },
  ).pipe(Effect.mapError((cause) => new CommandFailedError({ bin: input.bin, cause })));

  return { stdout, stderr, exitCode };
});

const runBounded = (
  spawner: ChildProcessSpawner.ChildProcessSpawner["Service"],
  input: Command,
): Effect.Effect<Result, CommandError> => {
  const body = Effect.scopedWith((scope) =>
    runInScope(spawner, input).pipe(Effect.provideService(Scope.Scope, scope)),
  );

  // An interactive command lives as long as the human does. Only a command
  // that asked for a bound gets one; a TTY attach must not die at 60 s.
  if (input.tty === true && input.timeoutMs === undefined) return body;

  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return body.pipe(
    // The timeout wraps the scope, so expiry interrupts the body and the scope
    // closes the child.
    Effect.timeoutOption(Duration.millis(timeoutMs)),
    Effect.flatMap(
      Option.match({
        onSome: Effect.succeed,
        onNone: () => Effect.fail(new CommandTimeoutError({ bin: input.bin, timeoutMs })),
      }),
    ),
  );
};

export const layer: Layer.Layer<ProcessRunner, never, ChildProcessSpawner.ChildProcessSpawner> =
  Layer.effect(
    ProcessRunner,
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const run = Effect.fn("ProcessRunner.run")(function* (command: Command) {
        return yield* runBounded(spawner, command);
      });
      return ProcessRunner.of({ run });
    }),
  );
