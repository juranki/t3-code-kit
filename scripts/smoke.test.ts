import { describe, expect, it } from "@effect/vitest";
import { NodeServices } from "@effect/platform-node";
import { Git } from "@t3ck/host/Git";
import * as HostProcess from "@t3ck/host/HostProcess";
import { ProcessRunner, type Command } from "@t3ck/host/ProcessRunner";
import { make as makeFakeSbx } from "@t3ck/sbx/fake";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { TestConsole } from "effect/testing";

import { dockerfileArg, nonEmpty, positiveInt, runSmoke } from "./smoke.ts";

describe("smoke helpers", () => {
  it("treats an empty environment value as unset", () => {
    expect(nonEmpty(undefined)).toBeUndefined();
    expect(nonEmpty("  ")).toBeUndefined();
    expect(nonEmpty(" t3ck-smoke ")).toBe("t3ck-smoke");
  });

  it("falls back on a missing or non-positive integer", () => {
    expect(positiveInt(undefined, 3773)).toBe(3773);
    expect(positiveInt("0", 3773)).toBe(3773);
    expect(positiveInt("nope", 3773)).toBe(3773);
    expect(positiveInt("40773", 3773)).toBe(40_773);
  });

  it("reads a pinned build arg out of the Dockerfile", () => {
    const text = "ARG CHROME_VERSION=156.0.8078.70\nARG TARGETARCH\n";
    expect(dockerfileArg(text, "CHROME_VERSION")).toBe("156.0.8078.70");
    expect(dockerfileArg(text, "TARGETARCH")).toBeUndefined();
  });
});

const runWithStartupFailure = (stderr: string) => {
  const commands: Array<Command> = [];
  const fake = makeFakeSbx({
    rules: [{ match: (command) => command.args.includes("ls"), response: { stdout: "[]" } }],
  });
  const runner = ProcessRunner.of({
    run: (command) => {
      commands.push(command);
      const failed = command.args[1] === "up" && command.env?.T3CK_PORT === "3774";
      return Effect.succeed({
        stdout: "",
        stderr: failed ? stderr : "",
        exitCode: failed ? 1 : 0,
      });
    },
  });
  return runSmoke().pipe(
    Effect.provideService(HostProcess.Environment, { T3CK_PORT: "3774" }),
    Effect.provideService(HostProcess.Arguments, ["node", "smoke.ts"]),
    Effect.provideService(
      Git,
      Git.of({ identity: () => Effect.succeed({ name: "Test User", email: "test@example.com" }) }),
    ),
    Effect.provideService(ProcessRunner, runner),
    Effect.provide(Layer.mergeAll(fake.layer, NodeServices.layer, TestConsole.layer)),
    Effect.as(commands),
  );
};

describe("smoke host port", () => {
  it.effect("uses the fallback port for startup, reachability, URL and rebuild", () =>
    Effect.gen(function* () {
      const bindFailure =
        "error: publish host 127.0.0.1:3774 -> sandbox port 3773/tcp4: port not available: " +
        "mapping ports: failed to bind host port 127.0.0.1:3774/tcp: listen tcp4 127.0.0.1:3774: " +
        "bind: Only one usage of each socket address (protocol/network address/port) is normally permitted.";
      const commands = yield* runWithStartupFailure(bindFailure);
      const cli = commands.filter((command) => command.env?.T3CK_PORT !== undefined);
      expect(cli.map((command) => [command.args[1], command.env?.T3CK_PORT])).toEqual([
        ["up", "3774"],
        ["up", "3775"],
        ["url", "3775"],
        ["rebuild", "3775"],
      ]);
      expect(commands.find((command) => command.bin === "curl")?.args.at(-1)).toBe(
        "http://localhost:3775/",
      );
    }),
  );

  it.effect("reports unrelated startup failures without trying another port", () =>
    Effect.gen(function* () {
      const commands = yield* runWithStartupFailure("error: could not build image");
      expect(commands.map((command) => [command.args[1], command.env?.T3CK_PORT])).toEqual([
        ["up", "3774"],
      ]);
    }),
  );
});
