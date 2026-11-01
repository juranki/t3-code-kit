// The fake adapter: a scripted `sbx` that records the commands the seam built.
// This is what a verb test provides instead of a stub executable on PATH.
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import type { Capabilities } from "./capabilities.ts";
import type { Command } from "./command.ts";
import { SbxNotFoundError, SbxTimeoutError } from "./errors.ts";
import { Adapter, Sbx, layer as sbxLayer, type RawResult } from "./Sbx.ts";
import { verbOf } from "./support.ts";

export interface FakeResponse {
  readonly stdout?: string;
  readonly stderr?: string;
  readonly exitCode?: number;
  /** Simulate a spawn failure instead of a process result. */
  readonly fail?: "not-found" | "timeout";
}

export interface FakeRule {
  readonly match: (command: Command) => boolean;
  readonly response: FakeResponse;
}

export interface FakeOptions {
  readonly capabilities?: Capabilities;
  readonly rules?: ReadonlyArray<FakeRule>;
  readonly fallback?: FakeResponse;
}

export interface FakeSbx {
  readonly adapter: Adapter["Service"];
  readonly layer: Layer.Layer<Sbx>;
  readonly commands: ReadonlyArray<Command>;
  readonly reset: () => void;
}

export const defaultCapabilities: Capabilities = {
  mode: "local",
  version: "fake 0.0.0",
  volumes: "unsupported",
  rm: { force: true, purge: false },
  egress: "deny-by-default",
  secrets: true,
};

export const make = (options: FakeOptions = {}): FakeSbx => {
  const commands: Array<Command> = [];
  const fallback = options.fallback ?? { stdout: "", stderr: "", exitCode: 0 };

  const respond = (input: Command): FakeResponse => {
    commands.push(input);
    return options.rules?.find((rule) => rule.match(input))?.response ?? fallback;
  };

  const run = (input: Command) => {
    const response = respond(input);
    if (response.fail === "not-found") {
      return Effect.fail(new SbxNotFoundError({ searched: ["fake"] }));
    }
    if (response.fail === "timeout") {
      return Effect.fail(
        new SbxTimeoutError({ verb: verbOf(input), timeoutMs: input.timeoutMs ?? 0 }),
      );
    }
    return Effect.succeed({
      stdout: response.stdout ?? "",
      stderr: response.stderr ?? "",
      exitCode: response.exitCode ?? 0,
    } satisfies RawResult);
  };

  const adapter = Adapter.of({
    run,
    capabilities: Effect.succeed(options.capabilities ?? defaultCapabilities),
  });

  return {
    adapter,
    layer: sbxLayer.pipe(Layer.provide(Layer.succeed(Adapter, adapter))),
    commands,
    reset: () => {
      commands.length = 0;
    },
  };
};

/** A convenience for the common "this command fails" rule. */
export const fails = (exitCode: number, stderr: string): FakeResponse => ({
  stderr,
  exitCode,
});
