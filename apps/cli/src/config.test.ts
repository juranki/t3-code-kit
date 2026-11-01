import { describe, expect, it } from "@effect/vitest";
import * as HostProcess from "@t3ck/host/HostProcess";
import * as Effect from "effect/Effect";

import {
  DEFAULT_HOST_PORT,
  DEFAULT_READY_TIMEOUT,
  resolveName,
  resolvePort,
  resolveReadyTimeout,
} from "./config.ts";

const withEnv = <A, E>(env: NodeJS.ProcessEnv, effect: Effect.Effect<A, E>) =>
  effect.pipe(Effect.provideService(HostProcess.Environment, env));

describe("resolveName", () => {
  it.effect("prefers the argument", () =>
    Effect.gen(function* () {
      expect(yield* withEnv({ T3CK_NAME: "from-env" }, resolveName("from-arg"))).toBe("from-arg");
    }),
  );

  it.effect("falls back to T3CK_NAME", () =>
    Effect.gen(function* () {
      expect(yield* withEnv({ T3CK_NAME: "from-env" }, resolveName(undefined))).toBe("from-env");
    }),
  );

  it.effect("fails with the launcher's sentence", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(withEnv({ T3CK_NAME: "" }, resolveName(undefined)));
      expect(error.reason).toBe("no sandbox name: pass one, or set T3CK_NAME");
    }),
  );
});

describe("resolvePort", () => {
  it.effect("defaults to the container's published port", () =>
    Effect.gen(function* () {
      expect(yield* withEnv({}, resolvePort)).toBe(DEFAULT_HOST_PORT);
    }),
  );

  it.effect("reads T3CK_PORT", () =>
    Effect.gen(function* () {
      expect(yield* withEnv({ T3CK_PORT: "40773" }, resolvePort)).toBe(40_773);
    }),
  );

  it.effect("rejects a non-numeric port", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(withEnv({ T3CK_PORT: "nope" }, resolvePort));
      expect(error.reason).toBe("invalid T3CK_PORT 'nope'");
    }),
  );
});

describe("resolveReadyTimeout", () => {
  it.effect("defaults to the sh launcher's window", () =>
    Effect.gen(function* () {
      expect(yield* withEnv({}, resolveReadyTimeout)).toBe(DEFAULT_READY_TIMEOUT);
    }),
  );

  it.effect("reads T3CK_READY_TIMEOUT", () =>
    Effect.gen(function* () {
      expect(yield* withEnv({ T3CK_READY_TIMEOUT: "5" }, resolveReadyTimeout)).toBe(5);
    }),
  );

  it.effect("rejects a negative timeout", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(withEnv({ T3CK_READY_TIMEOUT: "-1" }, resolveReadyTimeout));
      expect(error.reason).toBe("invalid T3CK_READY_TIMEOUT '-1'");
    }),
  );
});
