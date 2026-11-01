# Typed errors

Source of truth: `repos/effect/LLMS.md` ("Error handling"),
`repos/effect/packages/effect/src/Schema.ts` (`TaggedError`), and t3code's
`docs/internals/effect-services.md` ("Errors").

## Define

```ts
import * as Schema from "effect/Schema";

export class SbxCommandError extends Schema.TaggedError<SbxCommandError>()("SbxCommandError", {
  verb: Schema.String,
  exitCode: Schema.NullOr(Schema.Int),
  stderr: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return this.exitCode === null
      ? `sbx ${this.verb} could not run.`
      : `sbx ${this.verb} exited ${this.exitCode}.`;
  }
}
```

- The first type parameter is the class itself; the first argument is the tag.
- Attributes are structured and bounded. `Schema.Defect()` is the place for the
  underlying error; never put `cause.message` into the message.
- `override get message()` is optional. When present, build it from attributes
  only. A fixed message is fine.
- One class per distinction that drives control flow or a user-facing message.
  Do not add a single-value `operation`/`reason`/`kind` field next to a tag that
  already says the same thing.
- No helper that only does `(...args) => new SomeError({ ...args })`.

## Fail and catch

```ts
return yield * new SandboxMissingError({ name });
```

`yield*` on a `YieldableError` fails the effect. Always `return yield*` so
TypeScript knows execution stops.

Catch known tags with `Effect.catchTags`, even for one tag. `Effect.catch` is
for the whole channel; `Effect.catchIf` is for structural checks such as a
platform error code.

```ts
program.pipe(
  Effect.catchTags({
    SandboxMissingError: () => Effect.succeed(undefined),
    SbxTimeoutError: (error) => Effect.logWarning(error.message).pipe(Effect.as(undefined)),
  }),
);
```

## Attributes stay safe

The error channel is not a log sink. Attributes and log annotations stay
bounded: no raw command output, credentials, signed URLs, query strings, or
arbitrary defect text. The exact value lives in `cause`. Expose a category,
length, count, or a sanitized tail instead.

For `sbx`, `stderr` is the one attribute that earns an exception because it is
what the user needs to fix the failure. Bound it (4,000 characters) and redact
token-shaped JSON values before it becomes an attribute:

```ts
const redact = (output: string) =>
  output.replace(
    /("(?:access_token|bearerToken|credential|pairingToken|token)"\s*:\s*")[^"]+(")/giu,
    "$1[redacted]$2",
  );
```

Reference: `repos/effect/packages/effect/src/Schema.ts` around `TaggedError`,
and `repos/effect/ai-docs/src/01_effect/04_errors/`.
