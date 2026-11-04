// The CLI's own error and output vocabulary. A verb either handles a seam
// failure (a warning, a fallback) or turns it into a `CliError` with the
// user-facing sentence the old launchers used. `main.ts` is the only place that
// prints a `CliError` and chooses its exit code.
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import type { SbxError } from "@t3ck/sbx/Sbx";

export class CliError extends Schema.TaggedError<CliError, { readonly brand: unique symbol }>()(
  "CliError",
  {
    reason: Schema.String,
    exitCode: Schema.Int,
  },
) {
  override get message(): string {
    return this.reason;
  }
}

export const fail = (reason: string, exitCode = 1): Effect.Effect<never, CliError> =>
  Effect.fail(new CliError({ reason, exitCode }));

export const say = (message: string): Effect.Effect<void> => Console.log(message);

/** The old launchers' warning marker. The characterization harness strips it,
 * so the wording after it is the contract. */
export const warn = (message: string): Effect.Effect<void> => Console.error(`⚠️  ${message}`);

/** Print the part of a seam failure a user can act on. A command that ran and
 * wrote to stderr gets that text; everything else gets the error's own
 * sentence. */
export const reportSbxError = (error: SbxError): Effect.Effect<void> =>
  Effect.gen(function* () {
    if (error._tag === "SbxCommandError") {
      if (error.stderr.length > 0) yield* Console.error(error.stderr.trimEnd());
      return;
    }
    yield* Console.error(error.message);
  });

/** Report a seam failure and replace it with the sentence the verb promised. */
export const withContext = <A, E extends SbxError>(
  effect: Effect.Effect<A, E>,
  reason: string,
): Effect.Effect<A, CliError> =>
  effect.pipe(Effect.catch((error) => Effect.andThen(reportSbxError(error), fail(reason))));
