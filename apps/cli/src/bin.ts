#!/usr/bin/env node
// The v2 CLI entry. `npm run <verb>` reaches this; `import.meta.main` keeps the
// module importable by tests.
import { NodeServices } from "@effect/platform-node";
import { layer as gitLayer } from "@t3ck/host/Git";
import * as HostProcess from "@t3ck/host/HostProcess";
import { layer as processRunnerLayer } from "@t3ck/host/ProcessRunner";
import { layer as sbxLayer } from "@t3ck/sbx/live";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { run } from "./main.ts";

if (import.meta.main) {
  const layer = Layer.mergeAll(sbxLayer, gitLayer).pipe(
    Layer.provideMerge(processRunnerLayer),
    Layer.provideMerge(NodeServices.layer),
  );

  const program = Effect.gen(function* () {
    const argv = yield* HostProcess.Arguments;
    const exitCode = yield* run(argv.slice(2));
    yield* HostProcess.setExitCode(exitCode);
  });

  await Effect.runPromise(program.pipe(Effect.provide(layer)));
}
