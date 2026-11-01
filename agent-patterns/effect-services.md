# Effect services

Source of truth: `repos/effect/LLMS.md` ("Writing Effect services"),
`repos/effect/packages/effect/src/Context.ts`, and
`repos/effect/ai-docs/src/01_effect/03_services/`.

The project conventions (module order, naming, error rules) come from t3code's
`docs/internals/effect-services.md`; this file records the API shape those
conventions assume in Effect 4.

## Shape

One module per service, in this order: imports, errors and schemas, the
`Context.Service` tag with its interface inline, `make`, then `layer`.

```ts
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

export class SbxNotFoundError extends Schema.TaggedError<SbxNotFoundError>()("SbxNotFoundError", {
  searched: Schema.Array(Schema.String),
}) {}

export class Sbx extends Context.Service<
  Sbx,
  {
    readonly list: () => Effect.Effect<ReadonlyArray<SandboxSummary>, SbxCommandError>;
  }
>()("t3ck/Sbx") {}

const make = Effect.gen(function* () {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  return Sbx.of({ list });
});

export const layer = Layer.effect(Sbx, make);
```

- The class value is the context key. `yield* Sbx` retrieves it; `Sbx.of(...)`
  constructs the implementation.
- The service type is `Sbx["Service"]`; do not declare a separate `SbxShape`.
- Dependencies come from the environment (`yield* ChildProcessSpawner...`), not
  from parameters to `make`, so the `R` of `make` shows what the layer needs.

Reference: `repos/effect/ai-docs/src/01_effect/03_services/20_layer-composition.ts`.

## `Context.Reference` for host facts

A reference is a service with a default. Production code reads it with no layer;
a test provides it instead of monkey-patching a global.

```ts
export const Platform = Context.Reference<NodeJS.Platform>("@t3ck/host/HostProcess/Platform", {
  defaultValue: () => process.platform,
});
```

`packages/host/src/HostProcess.ts` is the only module allowed to read `process`
and `node:os`; everything else reads the reference. See
`repos/effect/ai-docs/src/01_effect/03_services/10_reference.ts`.

## `Effect.fn` for reusable functions

Use `Effect.fn("Service.operation")` for a reusable function that returns an
Effect. The named form creates a span; `Effect.fn(function* ...)` only captures
stack frames. Use `Effect.fn.Return<A, E, R>` when the generator needs an
explicit return type.

```ts
const list = Effect.fn("Sbx.list")(function* () {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const stdout = yield* spawner.string(ChildProcess.make("sbx", ["ls"]));
  return parseSandboxList(stdout);
});
```

- Keep `Effect.gen` for inline programs and layer construction.
- Put combinators after the generator body, not in a `.pipe` after the call:
  `Effect.fn("Sbx.list")(function* () { ... }, Effect.mapError(...))`.
- `Effect.fnUntraced` is for per-chunk work or a helper already covered by an
  enclosing span; say why in a comment.

Reference: `repos/effect/LLMS.md` ("Using Effect.fn and Effect.fnUntraced") and
`repos/effect/packages/effect/src/Effect.ts` (`fn` namespace).

## Layers

- `Layer.effect(Service, make)` when construction can fail or needs services.
- `Layer.succeed(Service, value)` when it cannot.
- `Layer.provide` exposes only the service; `Layer.provideMerge` exposes the
  service and its dependency.
- A fake layer is a normal `Layer.succeed`/`Layer.effect`; it is how verb tests
  replace `Sbx` without a process.

Reference: `repos/effect/ai-docs/src/01_effect/03_services/20_layer-composition.ts`
and `repos/effect/ai-docs/src/09_testing/20_layer-tests.ts`.

## Runtime boundaries

`ManagedRuntime.make`, `runPromise`, and `runPromiseExit` belong at the
application boundary: the CLI entry, a framework handler, a native callback.
Never in a domain service, repository, or service constructor. Provide the
runtime's layer once and run the program once.

Reference: `repos/effect/ai-docs/src/01_effect/06_running/10_run-main.ts`.
