// The host's git identity, read once for `up`.
//
// `git config --get` exits 1 when a key is unset, which is the normal "host has
// no config" case, not an error. A missing git, a timeout, or any other failure
// means the same thing to the caller: no identity, so `up` uses its fallback
// and warns. That is why `identity` has no failure channel.
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { ProcessRunner } from "./ProcessRunner.ts";

export interface GitIdentity {
  readonly name: string | undefined;
  readonly email: string | undefined;
}

export class Git extends Context.Service<
  Git,
  {
    readonly identity: () => Effect.Effect<GitIdentity>;
  }
>()("@t3ck/host/Git") {}

export const layer: Layer.Layer<Git, never, ProcessRunner> = Layer.effect(
  Git,
  Effect.gen(function* () {
    const runner = yield* ProcessRunner;

    const read = (key: string): Effect.Effect<string | undefined> =>
      runner.run({ bin: "git", args: ["config", "--get", key] }).pipe(
        Effect.map((result) => {
          const value = result.exitCode === 0 ? result.stdout.trim() : "";
          return value.length > 0 ? value : undefined;
        }),
        Effect.orElseSucceed(() => undefined),
      );

    const identity = Effect.fn("Git.identity")(function* () {
      return yield* Effect.all(
        { name: read("user.name"), email: read("user.email") },
        { concurrency: "unbounded" },
      );
    });

    return Git.of({ identity });
  }),
);
