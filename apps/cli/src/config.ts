// Every host fact the verbs read, resolved once. The environment is a
// `Context.Reference`, so a test provides a map instead of mutating `process`.
import * as HostProcess from "@t3ck/host/HostProcess";
import * as Effect from "effect/Effect";
import * as Path from "effect/Path";

import { fail, type CliError } from "./cli.ts";

export const CONTAINER_PORT = 3773;
export const DEFAULT_HOST_PORT = 3773;
/** The sh launcher's default. A first build is not inside this window: the
 * readiness wait starts after `create` and `run` have returned. */
export const DEFAULT_READY_TIMEOUT = 180;

export const resolveName = (candidate: string | undefined): Effect.Effect<string, CliError> =>
  Effect.gen(function* () {
    const env = yield* HostProcess.Environment;
    const name = candidate !== undefined && candidate.length > 0 ? candidate : env.T3CK_NAME;
    if (name === undefined || name.length === 0) {
      return yield* fail("no sandbox name: pass one, or set T3CK_NAME");
    }
    return name;
  });

export const resolvePort: Effect.Effect<number, CliError> = Effect.gen(function* () {
  const env = yield* HostProcess.Environment;
  const raw = env.T3CK_PORT;
  if (raw === undefined || raw.length === 0) return DEFAULT_HOST_PORT;
  const port = Number.parseInt(raw, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    return yield* fail(`invalid T3CK_PORT '${raw}'`);
  }
  return port;
});

export const resolveReadyTimeout: Effect.Effect<number, CliError> = Effect.gen(function* () {
  const env = yield* HostProcess.Environment;
  const raw = env.T3CK_READY_TIMEOUT;
  if (raw === undefined || raw.length === 0) return DEFAULT_READY_TIMEOUT;
  const seconds = Number.parseInt(raw, 10);
  if (!Number.isInteger(seconds) || seconds < 0) {
    return yield* fail(`invalid T3CK_READY_TIMEOUT '${raw}'`);
  }
  return seconds;
});

/** Prepended to the host's git user.name, because a sandbox commit is made by
 * an agent and should say so. An empty value is a deliberate opt-out, so only
 * an unset variable takes the default. */
export const agentNamePrefix: Effect.Effect<string> = Effect.map(
  HostProcess.Environment,
  (env) => env.T3CK_AGENT_NAME_PREFIX ?? "Agent for ",
);

/** The builder sandbox `sbx create` uses. A pre-set value wins, as it did in
 * both launchers; an empty value falls back to the default. */
export const kitBuilder: Effect.Effect<string> = Effect.map(
  HostProcess.Environment,
  (env) => env.SBX_KIT_BUILDER || "sandbox",
);

const repositoryRoot: Effect.Effect<string, never, Path.Path> = Effect.gen(function* () {
  const path = yield* Path.Path;
  // apps/cli/src -> apps/cli -> apps -> repo root
  return path.join(import.meta.dirname, "..", "..", "..");
});

export const kitDirectory: Effect.Effect<string, never, Path.Path> = Effect.gen(function* () {
  const path = yield* Path.Path;
  return path.join(yield* repositoryRoot, "kit");
});

export const policyPath: Effect.Effect<string, never, Path.Path> = Effect.gen(function* () {
  const path = yield* Path.Path;
  return path.join(yield* repositoryRoot, "policy", "allow.txt");
});
