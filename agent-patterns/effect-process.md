# Child processes

Source of truth: `repos/effect/ai-docs/src/60_child-process/10_working-with-child-processes.ts`,
`repos/effect/packages/effect/src/process/ChildProcess.ts`, and
`repos/effect/packages/effect/src/process/ChildProcessSpawner.ts`.

`sbx` is a real executable, so the seam spawns it directly with an argv array.
No `shell: true`, ever: a shell re-tokenizes arguments, and `sbx exec` passes
user-controlled values (a git name with a space, a multi-line wipe script) as
single argv words.

## Command as data

```ts
import { ChildProcess } from "effect/process";

const command = ChildProcess.make("sbx", ["exec", name, "--", "t3", "pair"], {
  extendEnv: true,
  env: { SBX_KIT_BUILDER: "sandbox" },
  cwd: "/some/dir",
  stdin: "ignore",
});
```

`ChildProcess.make` is overloaded; the `(command, args, options)` form is the
one to use. The command is an `Effect` that asks `ChildProcessSpawner` to start
the process and returns a handle. Keep the argv as `ReadonlyArray<string>` and
never join it into a string.

Options that matter here (all in `CommandOptions`):

| Option                        | Use                                                                                    |
| ----------------------------- | -------------------------------------------------------------------------------------- |
| `env` + `extendEnv: true`     | add a variable without dropping `PATH`                                                 |
| `cwd`                         | run in a specific directory                                                            |
| `stdin` / `stdout` / `stderr` | `"pipe"` (default), `"inherit"`, `"ignore"`, or a stream/sink                          |
| `shell`                       | leave unset; the only reason to set it is a `.cmd`/`.bat` shim, which `sbx.exe` is not |

For a TTY attach, set `stdin: "inherit", stdout: "inherit", stderr: "inherit"`.
For a captured command, leave them at the default and drain the handle.

## Spawn, drain, exit

```ts
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

const collect = <E>(stream: Stream.Stream<Uint8Array, E>) =>
  stream.pipe(
    Stream.decodeText(),
    Stream.runFold(
      () => "",
      (acc, chunk) => acc + chunk,
    ),
  );

const run = Effect.fn("Sbx.run")(function* (command: ChildProcess.StandardCommand) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const child = yield* spawner.spawn(command);
  const [stdout, stderr, exitCode] = yield* Effect.all(
    [collect(child.stdout), collect(child.stderr), child.exitCode.pipe(Effect.map(Number))],
    { concurrency: "unbounded" },
  );
  return { stdout, stderr, exitCode };
});
```

- **Drain stdout and stderr concurrently with the exit code.** Reading stdout to
  completion before touching stderr deadlocks when the child fills the other
  pipe.
- `spawn` requires a `Scope.Scope`. Use `Effect.scoped` when the function owns
  the lifetime, or `Effect.scopedWith((scope) => ...)` and
  `Effect.provideService(Scope.Scope, scope)` when the caller owns it. A
  caller-owned scope is what makes a timeout able to kill the child.
- `spawner.string(command)` and `spawner.lines(command)` are convenience
  wrappers that spawn, collect, and close for you. Use `spawn` when you need the
  handle or both streams.

## Timeout

Wrap the **scope**, not just the effect, so expiry interrupts the body and the
scope closes the child:

```ts
const bounded = Effect.scopedWith((scope) =>
  run(command).pipe(Effect.provideService(Scope.Scope, scope)),
).pipe(
  Effect.timeoutOption(Duration.millis(timeoutMs)),
  Effect.flatMap(
    Option.match({
      onSome: Effect.succeed,
      onNone: () => Effect.fail(new SbxTimeoutError({ verb, timeoutMs })),
    }),
  ),
);
```

`Effect.timeoutOption` keeps "timed out" separate from "the command failed":
`None` is the timeout, a non-zero exit is still a result the caller can inspect.
`Effect.timeout` would collapse both into one error.

## Errors

`spawn` fails with `PlatformError.PlatformError` when the process never starts
(binary missing, permission denied). A process that starts and exits non-zero is
**not** a failure: `child.exitCode` is a value. The seam decides which one is an
error:

- `exitCode: null` in a `SbxCommandError` means "never ran" (spawn failure or
  timeout).
- A numeric `exitCode` means "ran and said no"; keep the bounded, redacted
  `stderr` as an attribute.

## Fake spawner for tests

`ChildProcessSpawner.make(spawn)` builds a service from one function, and
`ChildProcessSpawner.makeHandle({ ... })` builds a synthetic handle. That is how
the seam is tested without a process:

```ts
const spawner = ChildProcessSpawner.make((command) => {
  if (ChildProcess.isStandardCommand(command)) {
    recorded.push(command.args);
  }
  return Effect.succeed(
    ChildProcessSpawner.makeHandle({
      pid: ChildProcessSpawner.ProcessId(123),
      stdout: Stream.make(new TextEncoder().encode("ok\n")),
      stderr: Stream.empty,
      all: Stream.empty,
      exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(0)),
      isRunning: Effect.succeed(false),
      kill: () => Effect.void,
      stdin: Sink.drain,
      getInputFd: () => Sink.drain,
      getOutputFd: () => Stream.empty,
      unref: Effect.succeed(Effect.void),
    }),
  );
});
```

`NodeServices.layer` supplies the real `ChildProcessSpawner`, `FileSystem`,
`Path`, `Crypto`, `Stdio`, and `Terminal`. A test provides `NodeServices.layer`
and overrides only the spawner:

```ts
Effect.provide(
  Layer.merge(NodeServices.layer, Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, spawner)),
);
```

Reference: `repos/effect/packages/effect/src/process/ChildProcessSpawner.ts`
(`make`, `makeHandle`) and `repos/effect/packages/platform/node/src/NodeServices.ts`.
