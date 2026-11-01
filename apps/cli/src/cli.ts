// The CLI's own error and output vocabulary. A verb either handles a seam
// failure (a warning, a fallback) or turns it into a `CliError` with the
// user-facing sentence the old launchers used. `main.ts` is the only place that
// prints a `CliError` and chooses its exit code.
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

export class CliError extends Schema.TaggedError<CliError>()("CliError", {
  reason: Schema.String,
  exitCode: Schema.Int,
}) {
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
