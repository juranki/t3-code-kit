# Testing Effect code

Source of truth: `repos/effect/ai-docs/src/09_testing/` and
`repos/effect/LLMS.md` ("Testing Effect programs").

The workspace uses `@effect/vitest` 4.0.5 under `vite-plus`. `it.effect` runs
on `TestClock`; `it.live` runs on the real clock and is only for subprocess or
network fixtures. There is no `retry`; a flaky test is fixed.

## Two test kinds

```ts
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

describe("Sbx", () => {
  it.effect("parses a sandbox listing", () =>
    Effect.gen(function* () {
      const rows = parseSandboxList("NAME  STATE\nbox  running\n");
      assert.deepStrictEqual(rows, [{ name: "box", state: "running" }]);
    }),
  );

  it.live("runs the real binary", () =>
    Effect.gen(function* () {
      const result = yield* runSbx({ argv: ["version"] });
      assert.include(result.stdout, "sbx");
    }),
  );
});
```

- `it.effect` is the default. It uses `TestClock`, so `Effect.sleep` and
  timeouts are virtual and fast.
- `it.live` is for a real subprocess, filesystem, or socket. Use it sparingly.
- `it.effect.each([...])` for a table; `it.effect.prop` with Schema arbitraries
  for property tests.
- `it.skip` needs a `// quarantine: #1234 <why>` comment.

Reference: `repos/effect/ai-docs/src/09_testing/10_effect-tests.ts`.

## Replace the external dependency, not the logic

The seam is a `Context.Service`, so a test provides a fake layer and asserts the
decisions the caller makes. Do not mock the code under test.

```ts
const fakeSbx = Layer.succeed(
  Sbx,
  Sbx.of({
    list: () => Effect.succeed([{ name: "box", state: "running" }]),
    exec: (input) => Effect.succeed({ stdout: "", stderr: "", exitCode: 0 }),
    // ...
  }),
);

program.pipe(Effect.provide(fakeSbx));
```

For a service that owns construction, use `Layer.effect` and `Layer.provide` /
`Layer.provideMerge` to compose the fake. `layer(...)` from `@effect/vitest`
shares one layer across the tests in a block and tears it down in `afterAll`.

Reference: `repos/effect/ai-docs/src/09_testing/20_layer-tests.ts`.

## Fake the spawner, not `sbx`

`packages/sbx` is tested at two levels:

1. **Pure parsers** — `parseSandboxList`, `parseSecretRows`, `parsePairingUrl`.
   No services.
2. **The seam over a fake spawner** — `ChildProcessSpawner.make` plus
   `makeHandle` scripts stdout/stderr/exit for `runSbx`. This asserts argv,
   timeout, redaction, and the spawn-failure vs non-zero-exit distinction
   without a process. See [`effect-process.md`](./effect-process.md).

A verb test then replaces `Sbx` itself with a fake layer and asserts the calls:
does `up` call `create` then `run` then `ports` then `pair`? does `nuke` wipe
before `rm --force`? The old stub-`sbx`-on-`PATH` trick becomes a
layer, and the assertion moves from stderr text to service calls.

## `NodeServices.layer`

When a test needs the real `FileSystem`, `Path`, `Crypto`, or `ChildProcessSpawner`,
provide `NodeServices.layer` from `@effect/platform-node`. To fake only the
spawner, merge it over:

```ts
Effect.provide(
  Layer.merge(
    NodeServices.layer,
    Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, fakeSpawner),
  ),
);
```

Reference: `repos/effect/packages/platform/node/src/NodeServices.ts`.
