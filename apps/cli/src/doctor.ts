// `doctor` reports what the seam's probe learned about this `sbx` installation.
// It deliberately does not re-derive capabilities from `sbx --help`: the probe
// is the one place those quirks are named, and a second reading would drift.
import * as Effect from "effect/Effect";

import { Sbx } from "@t3ck/sbx/Sbx";

import { renderCapabilities } from "./capabilities.ts";
import { say, withContext, type CliError } from "./cli.ts";

export const doctor = (): Effect.Effect<number, CliError, Sbx> =>
  Effect.gen(function* () {
    const sbx = yield* Sbx;
    const capabilities = yield* withContext(sbx.probe(), "could not probe sbx");

    yield* say("");
    yield* say("sbx capabilities:");
    for (const line of renderCapabilities(capabilities)) yield* say(`  ${line}`);
    yield* say("");
    return 0;
  });
