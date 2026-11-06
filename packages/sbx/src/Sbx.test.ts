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

// Captured from `sbx ls --json` on sbx v0.51.0, trimmed to the fields the
// seam reads. The first row is a sandbox with no published ports.
const listing = (name: string): string =>
  JSON.stringify([
    {
      name,
      id: "d337f82e-4fa2-46de-ade0-d43a17fb89ca",
      agent: "kit",
      status: "running",
      ports: [
        { host_ip: "127.0.0.1", host_port: 60006, sandbox_port: 3773, protocol: "tcp4" },
        { host_ip: "::1", host_port: 60006, sandbox_port: 3773, protocol: "tcp" },
      ],
      created_at: "2026-11-06T18:17:57Z",
      detached: true,
    },
  ]);

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
  it("reads the sbx ls json listing", () => {
    expect(parseSandboxList(listing("charprobe"))).toEqual([
      {
        name: "charprobe",
        agent: "kit",
        status: "running",
        ports: [
          { hostIp: "127.0.0.1", hostPort: 60006, sandboxPort: 3773, protocol: "tcp4" },
          { hostIp: "::1", hostPort: 60006, sandboxPort: 3773, protocol: "tcp" },
        ],
        createdAt: "2026-11-06T18:17:57Z",
      },
    ]);
  });

  it("reads a row that has no published ports", () => {
    expect(
      parseSandboxList(
        JSON.stringify([
          {
            name: "builder",
            agent: "kit",
            status: "running",
            created_at: "2026-11-01T17:49:58Z",
          },
        ]),
      ),
    ).toEqual([
      {
        name: "builder",
        agent: "kit",
        status: "running",
        ports: [],
        createdAt: "2026-11-01T17:49:58Z",
      },
    ]);
  });

  it("rejects a listing that is not json", () => {
    expect(() => parseSandboxList("charprobe\n")).toThrow();
  });

  it("rejects a row without a name", () => {
    expect(() => parseSandboxList(JSON.stringify([{ agent: "kit" }]))).toThrow();
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
          expect(runner.commands[0]?.args).toEqual([
            "--no-input",
            "exec",
            "demo",
            "--",
            "t3",
            "pair",
          ]);
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

  it.effect("adds -u when the command must run as another user", () => {
    const runner = makeRunner(() => ok());
    return withSbx(
      (sbx) =>
        Effect.gen(function* () {
          yield* sbx.exec({ name: "demo", argv: ["sh", "-c", "true"], user: "root" });
          expect(runner.commands[0]?.args).toEqual([
            "--no-input",
            "exec",
            "-u",
            "root",
            "demo",
            "--",
            "sh",
            "-c",
            "true",
          ]);
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
            "--no-input",
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
            ["--no-input", "ports", "demo"],
            ["--no-input", "ports", "demo", "--publish", "127.0.0.1:40773:3773"],
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
