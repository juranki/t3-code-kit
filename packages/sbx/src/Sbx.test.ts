import { describe, expect, it } from "@effect/vitest";
import {
  CommandNotFoundError,
  ProcessRunner,
  type Command,
  type CommandError,
  type Result,
} from "@t3ck/host/ProcessRunner";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { layer as liveLayer } from "./live.ts";
import {
  hostOf,
  parseSandboxList,
  parseSecretRows,
  publishedHostPorts,
  Sbx,
  splitStatus,
} from "./Sbx.ts";

const table = (name: string): string =>
  "  SANDBOX           AGENT             STATUS                 PORTS                                                                       WORKSPACE            CREATED\n" +
  `  ${name.padEnd(18)}kit               ● running (detached)   127.0.0.1:60006->3773/tcp, ::1:60006->3773/tcp                              D:\\src\\t3-code-kit   43s\n`;

interface FakeRunner {
  readonly layer: Layer.Layer<ProcessRunner>;
  readonly commands: ReadonlyArray<Command>;
}

const makeRunner = (
  handler: (command: Command) => Effect.Effect<Result, CommandError>,
): FakeRunner => {
  const commands: Array<Command> = [];
  return {
    layer: Layer.succeed(
      ProcessRunner,
      ProcessRunner.of({
        run: (command) => {
          commands.push(command);
          return handler(command);
        },
      }),
    ),
    commands,
  };
};

const ok = (stdout = ""): Effect.Effect<Result> =>
  Effect.succeed({ stdout, stderr: "", exitCode: 0 });

const withSbx = <A, E>(
  program: (sbx: Sbx["Service"]) => Effect.Effect<A, E>,
  runner: FakeRunner,
): Effect.Effect<A, E> =>
  Effect.gen(function* () {
    const sbx = yield* Sbx;
    return yield* program(sbx);
  }).pipe(Effect.provide(liveLayer.pipe(Layer.provide(runner.layer))));

describe("Sbx parsers", () => {
  it("slices the sbx ls table by header offsets", () => {
    expect(parseSandboxList(table("charprobe"))).toEqual([
      {
        name: "charprobe",
        agent: "kit",
        status: "● running (detached)",
        state: "running",
        ports: "127.0.0.1:60006->3773/tcp, ::1:60006->3773/tcp",
        workspace: "D:\\src\\t3-code-kit",
        created: "43s",
      },
    ]);
  });

  it("rejects a listing without the header", () => {
    expect(() => parseSandboxList("charprobe\n")).toThrow();
  });

  it("reads the third column as the secret name", () => {
    expect(parseSecretRows("SCOPE  TYPE   NAME    SECRET\nglobal api    github  ****\n")).toEqual([
      { scope: "global", type: "api", name: "github" },
    ]);
  });

  it("reads host ports from the sbx ports table", () => {
    expect(
      publishedHostPorts(
        "HOST IP     HOST PORT   SANDBOX PORT   PROTOCOL\n" +
          "127.0.0.1   3799        3773           tcp4\n" +
          "127.0.0.1   60001       3773           tcp\n" +
          "::1         60001       3773           tcp\n",
      ),
    ).toEqual([3799, 60_001, 60_001]);
  });

  it("reads host ports from the sbx ls inline form", () => {
    expect(publishedHostPorts("127.0.0.1:3774->3773/tcp4, 127.0.0.1:60008->3773/tcp\n")).toEqual([
      3774, 60_008,
    ]);
  });

  it("splits curl's status line from the body", () => {
    expect(splitStatus("body\n403")).toEqual(["body", "403"]);
    expect(splitStatus("no newline")).toEqual(["no newline", ""]);
  });

  it("names the host of a URL, and falls back to the input", () => {
    expect(hostOf("https://example.com/path")).toBe("example.com");
    expect(hostOf("not a url")).toBe("not a url");
  });
});

describe("Sbx over a fake process runner", () => {
  it.effect("builds the exec argv and returns a non-zero exit as data", () => {
    const runner = makeRunner(() => Effect.succeed({ stdout: "", stderr: "", exitCode: 7 }));
    return withSbx(
      (sbx) =>
        Effect.gen(function* () {
          const result = yield* sbx.exec({ name: "demo", argv: ["t3", "pair"] });
          expect(result.exitCode).toBe(7);
          expect(runner.commands[0]?.args).toEqual(["exec", "demo", "--", "t3", "pair"]);
        }),
      runner,
    );
  });

  it.effect("attaches the terminal with -it", () => {
    const runner = makeRunner(() => ok());
    return withSbx(
      (sbx) =>
        Effect.gen(function* () {
          yield* sbx.exec({ name: "demo", argv: ["bash"], tty: true });
          expect(runner.commands[0]?.args).toEqual(["exec", "-it", "demo", "--", "bash"]);
          expect(runner.commands[0]?.tty).toBe(true);
        }),
      runner,
    );
  });

  it.effect("maps a missing binary to SbxNotFoundError", () => {
    const runner = makeRunner(() => Effect.fail(new CommandNotFoundError({ bin: "sbx" })));
    return withSbx(
      (sbx) =>
        Effect.gen(function* () {
          const error = yield* Effect.flip(sbx.exec({ name: "demo", argv: ["true"] }));
          // eslint-disable-next-line no-underscore-dangle -- _tag is Effect's discriminant
          expect(error._tag).toBe("SbxNotFoundError");
        }),
      runner,
    );
  });

  it.effect("maps a missing sandbox to SandboxMissingError", () => {
    const runner = makeRunner(() =>
      Effect.succeed({ stdout: "", stderr: "no such sandbox: demo", exitCode: 1 }),
    );
    return withSbx(
      (sbx) =>
        Effect.gen(function* () {
          const error = yield* Effect.flip(sbx.exec({ name: "demo", argv: ["true"] }));
          // eslint-disable-next-line no-underscore-dangle -- _tag is Effect's discriminant
          expect(error._tag).toBe("SandboxMissingError");
        }),
      runner,
    );
  });

  it.effect("builds create with the loopback mapping and the builder env", () => {
    const runner = makeRunner(() => ok());
    return withSbx(
      (sbx) =>
        Effect.gen(function* () {
          yield* sbx.create({
            name: "demo",
            kitDir: "/kit",
            publish: { hostPort: 40_773, containerPort: 3773 },
            env: { SBX_KIT_BUILDER: "sandbox" },
          });
          expect(runner.commands[0]?.args).toEqual([
            "create",
            "--name",
            "demo",
            "-p",
            "127.0.0.1:40773:3773",
            "/kit",
          ]);
          expect(runner.commands[0]?.env).toEqual({ SBX_KIT_BUILDER: "sandbox" });
          // The first create builds the image; a 60-second default would kill it.
          expect(runner.commands[0]?.timeoutMs).toBe(60 * 60_000);
        }),
      runner,
    );
  });

  it.effect("maps a name conflict to SandboxExistsError", () => {
    const runner = makeRunner(() =>
      Effect.succeed({
        stdout: "",
        stderr: "error: sandbox 'demo' already exists; connect to the existing sandbox",
        exitCode: 1,
      }),
    );
    return withSbx(
      (sbx) =>
        Effect.gen(function* () {
          const error = yield* Effect.flip(sbx.create({ name: "demo", kitDir: "/kit" }));
          // eslint-disable-next-line no-underscore-dangle -- _tag is Effect's discriminant
          expect(error._tag).toBe("SandboxExistsError");
        }),
      runner,
    );
  });

  it.effect("does not treat a port conflict as a name conflict", () => {
    const runner = makeRunner(() =>
      Effect.succeed({
        stdout: "",
        stderr: "error: port 3774 is already allocated",
        exitCode: 1,
      }),
    );
    return withSbx(
      (sbx) =>
        Effect.gen(function* () {
          const result = yield* sbx.create({ name: "demo", kitDir: "/kit" });
          expect(result.exitCode).toBe(1);
        }),
      runner,
    );
  });

  it.effect("builds ports with and without --publish", () => {
    const runner = makeRunner(() => ok());
    return withSbx(
      (sbx) =>
        Effect.gen(function* () {
          yield* sbx.ports({ name: "demo" });
          yield* sbx.ports({
            name: "demo",
            publish: { hostPort: 40_773, containerPort: 3773 },
          });
          expect(runner.commands.map((command) => command.args)).toEqual([
            ["ports", "demo"],
            ["ports", "demo", "--publish", "127.0.0.1:40773:3773"],
          ]);
        }),
      runner,
    );
  });

  it.effect("parses the secret listing", () => {
    const runner = makeRunner(() =>
      ok("SCOPE  TYPE   NAME    SECRET\nglobal api    github  ****\n"),
    );
    return withSbx(
      (sbx) =>
        Effect.gen(function* () {
          const rows = yield* sbx.secrets();
          expect(rows).toEqual([{ scope: "global", type: "api", name: "github" }]);
        }),
      runner,
    );
  });
});
