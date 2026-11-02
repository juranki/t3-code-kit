import { describe, expect, it } from "@effect/vitest";
import { NodeServices } from "@effect/platform-node";
import { Git, type GitIdentity } from "@t3ck/host/Git";
import * as HostProcess from "@t3ck/host/HostProcess";
import { ProcessRunner } from "@t3ck/host/ProcessRunner";
import { make as makeFakeSbx, type FakeSbx } from "@t3ck/sbx/fake";
import { SbxCommandError } from "@t3ck/sbx/errors";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Terminal from "effect/Terminal";
import { TestConsole } from "effect/testing";

import { run } from "./main.ts";

const table = (name: string): string =>
  "  SANDBOX           AGENT             STATUS                 PORTS                                                                       WORKSPACE            CREATED\n" +
  `  ${name.padEnd(18)}kit               ● running (detached)   127.0.0.1:60006->3773/tcp, ::1:60006->3773/tcp                              D:\\src\\t3-code-kit   43s\n`;

const secretPresent = {
  stdout: "SCOPE  TYPE   NAME    SECRET\nglobal api    github  ****\n",
};

const defaultEnv: NodeJS.ProcessEnv = {
  T3CK_NAME: "charprobe",
  T3CK_PORT: "40773",
  T3CK_READY_TIMEOUT: "0",
  T3CK_AGENT_NAME_PREFIX: "Agent for ",
};

const appLayer = (fake: FakeSbx, identity: GitIdentity) =>
  Layer.mergeAll(
    fake.layer,
    Layer.succeed(
      Git,
      Git.of({
        identity: () => Effect.succeed(identity),
      }),
    ),
    Layer.succeed(
      ProcessRunner,
      ProcessRunner.of({
        run: () => Effect.succeed({ stdout: "", stderr: "", exitCode: 0 }),
      }),
    ),
    NodeServices.layer,
  );

interface RunOptions {
  readonly stdinIsTTY?: boolean;
  readonly terminal?: Terminal.Terminal;
}

const runCli = (
  argv: ReadonlyArray<string>,
  fake: FakeSbx,
  env: NodeJS.ProcessEnv = defaultEnv,
  identity: GitIdentity = { name: "Test User", email: "test@example.com" },
  options: RunOptions = {},
) => {
  let program = run(argv).pipe(Effect.provideService(HostProcess.Environment, env));
  if (options.stdinIsTTY !== undefined) {
    program = program.pipe(Effect.provideService(HostProcess.StdinIsTTY, options.stdinIsTTY));
  }
  if (options.terminal !== undefined) {
    program = program.pipe(Effect.provideService(Terminal.Terminal, options.terminal));
  }
  return program.pipe(Effect.provide(appLayer(fake, identity)));
};

const url = "http://10.0.0.1:9999/pair#token=abc123";
const localUrl = "http://localhost:40773/pair#token=abc123";

const baseRules = (lsName: string) => [
  {
    match: (command: { args: ReadonlyArray<string> }) => command.args[0] === "secret",
    response: secretPresent,
  },
  {
    match: (command: { args: ReadonlyArray<string> }) => command.args[0] === "ls",
    response: { stdout: table(lsName) },
  },
  {
    match: (command: { args: ReadonlyArray<string> }) => command.args[0] === "create",
    response: { stdout: "created\n" },
  },
  {
    match: (command: { args: ReadonlyArray<string> }) => command.args[0] === "run",
    response: { stdout: "" },
  },
  {
    match: (command: { args: ReadonlyArray<string> }) => command.args[0] === "ports",
    response: { stdout: "" },
  },
  {
    match: (command: { args: ReadonlyArray<string> }) =>
      command.args[0] === "exec" && command.args.includes("t3"),
    response: { stdout: `${url}\n` },
  },
  {
    match: (command: { args: ReadonlyArray<string> }) => command.args[0] === "exec",
    response: { stdout: "" },
  },
];

const argsOf = (fake: FakeSbx): ReadonlyArray<ReadonlyArray<string>> =>
  fake.commands.map((command) => command.args);

const decodeIdentity = (script: string | undefined): string => {
  const encoded = /'([A-Za-z0-9+/=]+)' \| base64 -d/u.exec(script ?? "")?.[1];
  return encoded === undefined ? "" : Buffer.from(encoded, "base64").toString("utf8");
};

describe("up", () => {
  it.effect("creates a missing sandbox, then starts it, sets identity, and prints the URL", () => {
    const fake = makeFakeSbx({ rules: baseRules("other") });
    return Effect.gen(function* () {
      const exit = yield* runCli(["up"], fake);
      expect(exit).toBe(0);
      const calls = argsOf(fake);
      expect(calls[0]).toEqual(["secret", "ls"]);
      expect(calls[1]).toEqual(["ls"]);
      expect(calls[2]?.slice(0, 5)).toEqual([
        "create",
        "--name",
        "charprobe",
        "-p",
        "127.0.0.1:40773:3773",
      ]);
      expect(calls[2]?.[5]).toMatch(/[\\/]kit$/u);
      expect(fake.commands[2]?.env).toEqual({ SBX_KIT_BUILDER: "sandbox" });
      expect(calls[3]).toEqual(["run", "-d", "--name", "charprobe"]);
      expect(calls[4]?.slice(0, 5)).toEqual(["exec", "charprobe", "--", "sh", "-c"]);
      expect(calls[4]?.[5]).toContain("user.name");
      expect(calls[5]?.[5]).toContain("user.email");
      expect(calls[6]).toEqual(["exec", "charprobe", "--", "t3", "pair"]);

      const logs = yield* TestConsole.logLines;
      expect(logs).toContain(localUrl);
    }).pipe(Effect.provide(TestConsole.layer));
  });

  it.effect("honours a pre-set SBX_KIT_BUILDER", () => {
    const fake = makeFakeSbx({ rules: baseRules("other") });
    return Effect.gen(function* () {
      expect(yield* runCli(["up"], fake, { ...defaultEnv, SBX_KIT_BUILDER: "host" })).toBe(0);
      expect(fake.commands[2]?.env).toEqual({ SBX_KIT_BUILDER: "host" });
    }).pipe(Effect.provide(TestConsole.layer));
  });

  it.effect("starts an existing sandbox and reuses a published port", () => {
    const fake = makeFakeSbx({
      rules: [
        ...baseRules("charprobe").filter(
          (rule) => rule.match({ args: ["ports"] } as never) === false,
        ),
        {
          match: (command) => command.args[0] === "ports",
          response: { stdout: "127.0.0.1:40773->3773/tcp\n" },
        },
      ],
    });
    return Effect.gen(function* () {
      const exit = yield* runCli(["up"], fake);
      expect(exit).toBe(0);
      const calls = argsOf(fake);
      expect(calls[2]).toEqual(["run", "-d", "--name", "charprobe"]);
      expect(calls[3]).toEqual(["ports", "charprobe"]);
      expect(calls.some((call) => call.includes("--publish"))).toBe(false);
    }).pipe(Effect.provide(TestConsole.layer));
  });

  it.effect("publishes the port when the existing sandbox has none", () => {
    const fake = makeFakeSbx({ rules: baseRules("charprobe") });
    return Effect.gen(function* () {
      const exit = yield* runCli(["up"], fake);
      expect(exit).toBe(0);
      expect(argsOf(fake)).toContainEqual([
        "ports",
        "charprobe",
        "--publish",
        "127.0.0.1:40773:3773",
      ]);
    }).pipe(Effect.provide(TestConsole.layer));
  });

  it.effect("warns when the github secret is genuinely absent", () => {
    const fake = makeFakeSbx({
      rules: [
        {
          match: (command) => command.args[0] === "secret",
          response: {
            stdout: "SCOPE  TYPE   NAME        SECRET\nglobal api    anthropic   ****\n",
          },
        },
        ...baseRules("other").slice(1),
      ],
    });
    return Effect.gen(function* () {
      const exit = yield* runCli(["up"], fake);
      expect(exit).toBe(0);
      const errors = yield* TestConsole.errorLines;
      expect(errors).toContain("⚠️  no 'github' secret on this host: clone/push will fail.");
      expect(errors).toContain("⚠️  set one with:  sbx secret set github");
    }).pipe(Effect.provide(TestConsole.layer));
  });

  it.effect("stays quiet when the secret listing itself failed", () => {
    const fake = makeFakeSbx({
      rules: [
        { match: (command) => command.args[0] === "secret", response: { exitCode: 1 } },
        ...baseRules("other").slice(1),
      ],
    });
    return Effect.gen(function* () {
      const exit = yield* runCli(["up"], fake);
      expect(exit).toBe(0);
      const errors = yield* TestConsole.errorLines;
      expect(errors.some((line) => String(line).includes("github"))).toBe(false);
    }).pipe(Effect.provide(TestConsole.layer));
  });

  it.effect("warns twice when the identity exec fails, but still prints the URL", () => {
    const fake = makeFakeSbx({
      rules: [
        ...baseRules("other").filter((rule) => rule.match({ args: ["exec"] } as never) === false),
        {
          match: (command) => command.args[0] === "exec" && command.args.includes("t3"),
          response: { stdout: `${url}\n` },
        },
        { match: (command) => command.args[0] === "exec", response: { exitCode: 1 } },
      ],
    });
    return Effect.gen(function* () {
      const exit = yield* runCli(["up"], fake);
      expect(exit).toBe(0);
      const errors = yield* TestConsole.errorLines;
      expect(
        errors.filter((line) => String(line).includes("could not set the git identity")),
      ).toHaveLength(2);
    }).pipe(Effect.provide(TestConsole.layer));
  });

  it.effect("prepends the prefix once to the host's bare name", () => {
    const fake = makeFakeSbx({ rules: baseRules("other") });
    return Effect.gen(function* () {
      const exit = yield* runCli(["up"], fake, defaultEnv, {
        name: "Juhani Ränkimies",
        email: "juhani@example.com",
      });
      expect(exit).toBe(0);
      const calls = argsOf(fake);
      expect(decodeIdentity(calls[4]?.[5])).toBe("Agent for Juhani Ränkimies");
      expect(decodeIdentity(calls[5]?.[5])).toBe("juhani@example.com");
    }).pipe(Effect.provide(TestConsole.layer));
  });

  it.effect("does not accumulate the prefix when the host is already decorated", () => {
    const fake = makeFakeSbx({ rules: baseRules("other") });
    return Effect.gen(function* () {
      const exit = yield* runCli(["up"], fake, defaultEnv, {
        name: "Agent for Juhani Ränkimies",
        email: "juhani@example.com",
      });
      expect(exit).toBe(0);
      expect(decodeIdentity(argsOf(fake)[4]?.[5])).toBe("Agent for Juhani Ränkimies");
    }).pipe(Effect.provide(TestConsole.layer));
  });

  it.effect("collapses a host name that carries the prefix many times", () => {
    const fake = makeFakeSbx({ rules: baseRules("other") });
    return Effect.gen(function* () {
      const exit = yield* runCli(["up"], fake, defaultEnv, {
        name: "Agent for Agent for Agent for Juhani Ränkimies",
        email: "juhani@example.com",
      });
      expect(exit).toBe(0);
      expect(decodeIdentity(argsOf(fake)[4]?.[5])).toBe("Agent for Juhani Ränkimies");
    }).pipe(Effect.provide(TestConsole.layer));
  });

  it.effect("writes the bare host name when the prefix is empty", () => {
    const fake = makeFakeSbx({ rules: baseRules("other") });
    return Effect.gen(function* () {
      const exit = yield* runCli(["up"], fake, {
        ...defaultEnv,
        T3CK_AGENT_NAME_PREFIX: "",
      });
      expect(exit).toBe(0);
      expect(decodeIdentity(argsOf(fake)[4]?.[5])).toBe("Test User");
    }).pipe(Effect.provide(TestConsole.layer));
  });

  it.effect("uses the fallback identity when the host has none", () => {
    const fake = makeFakeSbx({ rules: baseRules("other") });
    return Effect.gen(function* () {
      const exit = yield* runCli(["up"], fake, defaultEnv, {
        name: undefined,
        email: undefined,
      });
      expect(exit).toBe(0);
      const calls = argsOf(fake);
      expect(decodeIdentity(calls[4]?.[5])).toBe("Agent");
      expect(decodeIdentity(calls[5]?.[5])).toBe("agent@t3-code-kit");
      const errors = yield* TestConsole.errorLines;
      expect(errors).toContain(
        "⚠️  no user.name/user.email on this host; using Agent <agent@t3-code-kit>.",
      );
    }).pipe(Effect.provide(TestConsole.layer));
  });

  it.effect("fails when create fails", () => {
    const fake = makeFakeSbx({
      rules: [
        ...baseRules("other").filter((rule) => rule.match({ args: ["create"] } as never) === false),
        {
          match: (command) => command.args[0] === "create",
          response: { exitCode: 1, stderr: "build failed\n" },
        },
      ],
    });
    return Effect.gen(function* () {
      const exit = yield* runCli(["up"], fake);
      expect(exit).toBe(1);
      const errors = yield* TestConsole.errorLines;
      expect(errors).toContain("t3-code-kit: could not create sandbox 'charprobe'");
    }).pipe(Effect.provide(TestConsole.layer));
  });
});

describe("url", () => {
  it.effect("rewrites the pairing URL to the published loopback port", () => {
    const fake = makeFakeSbx({
      rules: [{ match: () => true, response: { stdout: `${url}\n` } }],
    });
    return Effect.gen(function* () {
      const exit = yield* runCli(["url"], fake);
      expect(exit).toBe(0);
      expect(argsOf(fake)).toEqual([["exec", "charprobe", "--", "t3", "pair"]]);
      expect(yield* TestConsole.logLines).toContain(localUrl);
    }).pipe(Effect.provide(TestConsole.layer));
  });

  it.effect("falls back to the serve.log pairing URL", () => {
    const fake = makeFakeSbx({
      rules: [
        {
          match: (command) => command.args.includes("t3"),
          response: { stdout: "" },
        },
        {
          match: (command) => command.args.includes("tail"),
          response: { stdout: `Pairing URL: ${url}\n` },
        },
      ],
    });
    return Effect.gen(function* () {
      const exit = yield* runCli(["url"], fake);
      expect(exit).toBe(0);
      expect(argsOf(fake)).toEqual([
        ["exec", "charprobe", "--", "t3", "pair"],
        ["exec", "charprobe", "--", "tail", "-n", "500", "/home/agent/.t3/serve.log"],
      ]);
      expect(yield* TestConsole.logLines).toContain(localUrl);
    }).pipe(Effect.provide(TestConsole.layer));
  });

  it.effect("fails when neither source has a pairing URL", () => {
    const fake = makeFakeSbx({ rules: [{ match: () => true, response: { stdout: "" } }] });
    return Effect.gen(function* () {
      const exit = yield* runCli(["url"], fake);
      expect(exit).toBe(1);
      const errors = yield* TestConsole.errorLines;
      expect(errors).toContain(
        "t3-code-kit: no pairing URL: is the server up? try: npm run logs -- charprobe",
      );
    }).pipe(Effect.provide(TestConsole.layer));
  });
});

describe("logs", () => {
  it.effect("tails the server log", () => {
    const fake = makeFakeSbx({
      rules: [
        {
          match: (command) => command.args.some((arg) => arg.endsWith("serve.log")),
          response: { stdout: "log line\n" },
        },
      ],
    });
    return Effect.gen(function* () {
      const exit = yield* runCli(["logs"], fake);
      expect(exit).toBe(0);
      expect(argsOf(fake)).toEqual([
        ["exec", "charprobe", "--", "tail", "-n", "200", "/home/agent/.t3/serve.log"],
      ]);
      expect(yield* TestConsole.logLines).toContain("log line");
    }).pipe(Effect.provide(TestConsole.layer));
  });

  it.effect("takes the line count from the second argument", () => {
    const fake = makeFakeSbx({
      rules: [{ match: () => true, response: { stdout: "log line\n" } }],
    });
    return Effect.gen(function* () {
      expect(yield* runCli(["logs", "charprobe", "50"], fake)).toBe(0);
      expect(argsOf(fake)).toEqual([
        ["exec", "charprobe", "--", "tail", "-n", "50", "/home/agent/.t3/serve.log"],
      ]);
    }).pipe(Effect.provide(TestConsole.layer));
  });

  it.effect("falls back to the startup-hook log and exits 0 even when both fail", () => {
    const fake = makeFakeSbx({
      rules: [
        {
          match: (command) => command.args.some((arg) => arg.endsWith("serve.log")),
          response: { exitCode: 1 },
        },
        {
          match: (command) => command.args.some((arg) => arg.endsWith("startup.log")),
          response: { exitCode: 1 },
        },
      ],
    });
    return Effect.gen(function* () {
      expect(yield* runCli(["logs"], fake)).toBe(0);
      const errors = yield* TestConsole.errorLines;
      expect(errors).toContain(
        "⚠️  no /home/agent/.t3/serve.log in 'charprobe' — serve.sh never started.",
      );
      expect(errors).toContain("⚠️  no startup-hook log either: the lifecycle@1 hook did not run.");
    }).pipe(Effect.provide(TestConsole.layer));
  });
});

describe("shell", () => {
  it.effect("opens bash with -it", () => {
    const fake = makeFakeSbx({ rules: [{ match: () => true, response: { stdout: "" } }] });
    return Effect.gen(function* () {
      expect(yield* runCli(["shell"], fake)).toBe(0);
      expect(argsOf(fake)).toEqual([["exec", "-it", "charprobe", "--", "bash"]]);
    }).pipe(Effect.provide(TestConsole.layer));
  });

  it.effect("falls back to attach when the exec fails", () => {
    const fake = makeFakeSbx({
      rules: [
        { match: (command) => command.args[0] === "exec", response: { exitCode: 1 } },
        { match: (command) => command.args[0] === "attach", response: { exitCode: 0 } },
      ],
    });
    return Effect.gen(function* () {
      expect(yield* runCli(["shell"], fake)).toBe(0);
      expect(argsOf(fake)).toEqual([
        ["exec", "-it", "charprobe", "--", "bash"],
        ["attach", "charprobe"],
      ]);
    }).pipe(Effect.provide(TestConsole.layer));
  });
});

describe("down and refresh", () => {
  it.effect("stops the sandbox", () => {
    const fake = makeFakeSbx({
      rules: [{ match: (command) => command.args[0] === "stop", response: { exitCode: 0 } }],
    });
    return Effect.gen(function* () {
      expect(yield* runCli(["down"], fake)).toBe(0);
      expect(argsOf(fake)).toEqual([["stop", "charprobe"]]);
    }).pipe(Effect.provide(TestConsole.layer));
  });

  it.effect("fails with the old launcher's sentence when stop fails", () => {
    const fake = makeFakeSbx({
      rules: [{ match: (command) => command.args[0] === "stop", response: { exitCode: 1 } }],
    });
    return Effect.gen(function* () {
      expect(yield* runCli(["down"], fake)).toBe(1);
      expect(yield* TestConsole.errorLines).toContain("t3-code-kit: could not stop 'charprobe'");
    }).pipe(Effect.provide(TestConsole.layer));
  });

  it.effect("stops and then runs the up sequence", () => {
    const fake = makeFakeSbx({
      rules: [
        { match: (command) => command.args[0] === "stop", response: { exitCode: 0 } },
        ...baseRules("charprobe"),
      ],
    });
    return Effect.gen(function* () {
      expect(yield* runCli(["refresh"], fake)).toBe(0);
      const calls = argsOf(fake);
      expect(calls[0]).toEqual(["stop", "charprobe"]);
      expect(calls[1]).toEqual(["secret", "ls"]);
      expect(calls[2]).toEqual(["ls"]);
      expect(calls[3]).toEqual(["run", "-d", "--name", "charprobe"]);
    }).pipe(Effect.provide(TestConsole.layer));
  });

  it.effect("does not re-publish a port already in the sbx ports table", () => {
    const fake = makeFakeSbx({
      rules: [
        { match: (command) => command.args[0] === "stop", response: { exitCode: 0 } },
        ...baseRules("charprobe").filter(
          (rule) => rule.match({ args: ["ports"] } as never) === false,
        ),
        {
          match: (command) => command.args[0] === "ports",
          response: {
            stdout:
              "HOST IP     HOST PORT   SANDBOX PORT   PROTOCOL\n" +
              "127.0.0.1   40773       3773           tcp4\n",
          },
        },
      ],
    });
    return Effect.gen(function* () {
      expect(yield* runCli(["refresh"], fake)).toBe(0);
      expect(argsOf(fake).some((call) => call.includes("--publish"))).toBe(false);
    }).pipe(Effect.provide(TestConsole.layer));
  });
});

describe("rebuild", () => {
  it.effect("removes the sandbox, then runs the up sequence", () => {
    const fake = makeFakeSbx({
      rules: [
        { match: (command) => command.args[0] === "rm", response: { exitCode: 0 } },
        ...baseRules("other"),
      ],
    });
    return Effect.gen(function* () {
      expect(yield* runCli(["rebuild"], fake)).toBe(0);
      const calls = argsOf(fake);
      expect(calls[0]).toEqual(["rm", "--force", "charprobe"]);
      expect(calls[1]).toEqual(["secret", "ls"]);
      expect(calls[2]).toEqual(["ls"]);
      expect(calls[3]?.slice(0, 5)).toEqual([
        "create",
        "--name",
        "charprobe",
        "-p",
        "127.0.0.1:40773:3773",
      ]);
      expect(yield* TestConsole.logLines).toContain(
        "recreating 'charprobe' from a freshly built image; repos and t3 state survive on their volumes.",
      );
    }).pipe(Effect.provide(TestConsole.layer));
  });

  it.effect("still recreates when rm fails", () => {
    const fake = makeFakeSbx({
      rules: [
        {
          match: (command) => command.args[0] === "rm",
          response: { exitCode: 1, stderr: "rm failed\n" },
        },
        ...baseRules("other"),
      ],
    });
    return Effect.gen(function* () {
      expect(yield* runCli(["rebuild"], fake)).toBe(0);
      expect(argsOf(fake)[1]).toEqual(["secret", "ls"]);
    }).pipe(Effect.provide(TestConsole.layer));
  });

  it.effect("rejects a state flag", () => {
    const fake = makeFakeSbx();
    return Effect.gen(function* () {
      expect(yield* runCli(["rebuild", "--reset-state"], fake)).toBe(2);
      expect(argsOf(fake)).toEqual([]);
      expect(yield* TestConsole.errorLines).toContain(
        "t3-code-kit: unknown option '--reset-state' (rebuild takes only a sandbox name)",
      );
    }).pipe(Effect.provide(TestConsole.layer));
  });
});

const nukeRules = (lsName: string, survivors = "") => [
  {
    match: (command: { args: ReadonlyArray<string> }) => command.args[0] === "ls",
    response: { stdout: table(lsName) },
  },
  {
    match: (command: { args: ReadonlyArray<string> }) =>
      command.args[0] === "exec" &&
      (command.args.at(-1) ?? "").includes(".t3ck-nuke-marker") &&
      (command.args.at(-1) ?? "").includes(">"),
    response: { stdout: "" },
  },
  {
    match: (command: { args: ReadonlyArray<string> }) =>
      command.args[0] === "exec" && (command.args.at(-1) ?? "").includes("-mindepth 1 -delete"),
    response: { stdout: "" },
  },
  {
    match: (command: { args: ReadonlyArray<string> }) =>
      command.args[0] === "exec" && (command.args.at(-1) ?? "").includes("[ ! -e"),
    response: { stdout: survivors },
  },
  {
    match: (command: { args: ReadonlyArray<string> }) => command.args[0] === "rm",
    response: { exitCode: 0 },
  },
];

describe("nuke", () => {
  it.effect("wipes the four volumes, verifies, then removes the instance", () => {
    const fake = makeFakeSbx({ rules: nukeRules("charprobe") });
    return Effect.gen(function* () {
      expect(yield* runCli(["nuke", "--yes"], fake)).toBe(0);
      const calls = argsOf(fake);
      expect(calls[0]).toEqual(["ls"]);
      expect(calls[1]?.slice(0, 5)).toEqual(["exec", "charprobe", "--", "sh", "-c"]);
      expect(calls[1]?.at(-1)).toContain(".t3ck-nuke-marker");
      expect(calls[2]?.slice(0, 7)).toEqual(["exec", "-u", "root", "charprobe", "--", "sh", "-c"]);
      const wipe = calls[2]?.at(-1) ?? "";
      expect(wipe).toContain("pkill -f '^t3 serve'");
      expect(wipe).toContain("pkill -x pi");
      for (const path of [
        "/home/agent/workspace",
        "/home/agent/.t3/userdata",
        "/home/agent/.t3/projects",
        "/home/agent/.t3/worktrees",
      ]) {
        expect(wipe).toContain(`find '${path}' -mindepth 1 -delete`);
      }
      expect(calls[3]?.slice(0, 5)).toEqual(["exec", "charprobe", "--", "sh", "-c"]);
      expect(calls[3]?.at(-1)).toContain("[ ! -e");
      expect(calls[4]).toEqual(["rm", "--force", "charprobe"]);
      expect(yield* TestConsole.logLines).toContain(
        "done. 'charprobe' is gone; its volume storage stays allocated, empty — sbx has no per-sandbox purge.",
      );
    }).pipe(Effect.provide(TestConsole.layer));
  });

  it.effect("refuses without --yes on a non-TTY and touches nothing", () => {
    const fake = makeFakeSbx({ rules: nukeRules("charprobe") });
    return Effect.gen(function* () {
      expect(yield* runCli(["nuke"], fake, defaultEnv, undefined, { stdinIsTTY: false })).toBe(2);
      // The existence check is read-only; the refusal comes before any wipe.
      expect(argsOf(fake)).toEqual([["ls"]]);
      expect(yield* TestConsole.errorLines).toContain(
        "t3-code-kit: refusing to nuke 'charprobe' without --yes on a non-TTY",
      );
    }).pipe(Effect.provide(TestConsole.layer));
  });

  it.effect("prompts for the name on a TTY and proceeds when it matches", () => {
    const displayed: Array<string> = [];
    const terminal = Terminal.make({
      columns: Effect.succeed(80),
      rows: Effect.succeed(24),
      readInput: Effect.die("not used"),
      readLine: Effect.succeed("charprobe"),
      display: (text) =>
        Effect.sync(() => {
          displayed.push(text);
        }),
    });
    const fake = makeFakeSbx({ rules: nukeRules("charprobe") });
    return Effect.gen(function* () {
      expect(
        yield* runCli(["nuke"], fake, defaultEnv, undefined, {
          stdinIsTTY: true,
          terminal,
        }),
      ).toBe(0);
      expect(displayed).toContain('Type "charprobe" to destroy it: ');
      expect(argsOf(fake)[0]).toEqual(["ls"]);
      expect(argsOf(fake).some((call) => call[0] === "rm")).toBe(true);
    }).pipe(Effect.provide(TestConsole.layer));
  });

  it.effect("stops on a TTY when the typed name does not match", () => {
    const terminal = Terminal.make({
      columns: Effect.succeed(80),
      rows: Effect.succeed(24),
      readInput: Effect.die("not used"),
      readLine: Effect.succeed("wrong"),
      display: () => Effect.void,
    });
    const fake = makeFakeSbx({ rules: nukeRules("charprobe") });
    return Effect.gen(function* () {
      expect(
        yield* runCli(["nuke"], fake, defaultEnv, undefined, {
          stdinIsTTY: true,
          terminal,
        }),
      ).toBe(2);
      // The existence check is read-only; the refusal comes before any wipe.
      expect(argsOf(fake)).toEqual([["ls"]]);
      expect(yield* TestConsole.errorLines).toContain(
        "t3-code-kit: not confirmed; nothing was removed.",
      );
    }).pipe(Effect.provide(TestConsole.layer));
  });

  it.effect("fails with the up-then-nuke remedy when the instance is missing", () => {
    const fake = makeFakeSbx({ rules: nukeRules("other") });
    return Effect.gen(function* () {
      expect(yield* runCli(["nuke", "--yes"], fake)).toBe(1);
      expect(argsOf(fake)).toEqual([["ls"]]);
      expect(yield* TestConsole.errorLines).toContain(
        "t3-code-kit: no sandbox named 'charprobe': its volume contents may still be on disk. run 'npm run up -- charprobe', then 'npm run nuke -- charprobe'",
      );
    }).pipe(Effect.provide(TestConsole.layer));
  });

  it.effect("aborts before rm when the wipe fails twice", () => {
    const fake = makeFakeSbx({
      rules: nukeRules("charprobe", "/home/agent/workspace/leftover\n"),
    });
    return Effect.gen(function* () {
      expect(yield* runCli(["nuke", "--yes"], fake)).toBe(1);
      const calls = argsOf(fake);
      expect(calls.some((call) => call[0] === "rm")).toBe(false);
      expect(
        calls.filter(
          (call) =>
            call[0] === "exec" &&
            (call.at(-1) ?? "").includes(".t3ck-nuke-marker") &&
            (call.at(-1) ?? "").includes(">"),
        ),
      ).toHaveLength(2);
      expect(
        calls.filter(
          (call) => call[0] === "exec" && (call.at(-1) ?? "").includes("-mindepth 1 -delete"),
        ),
      ).toHaveLength(2);
      expect(
        calls.filter((call) => call[0] === "exec" && (call.at(-1) ?? "").includes("[ ! -e")),
      ).toHaveLength(2);
      const errors = yield* TestConsole.errorLines;
      expect(errors).toContain("⚠️  wipe of 'charprobe' left data behind; retrying once");
      expect(errors).toContain(
        "t3-code-kit: could not wipe 'charprobe'; the sandbox was not removed (its data is still there)",
      );
    }).pipe(Effect.provide(TestConsole.layer));
  });

  it.effect("fails with the remedy when rm says the instance is missing", () => {
    const fake = makeFakeSbx({
      rules: [
        ...nukeRules("charprobe").filter((rule) => rule.match({ args: ["rm"] } as never) === false),
        {
          match: (command) => command.args[0] === "rm",
          response: { exitCode: 1, stderr: "error: sandbox 'charprobe' not found\n" },
        },
      ],
    });
    return Effect.gen(function* () {
      expect(yield* runCli(["nuke", "--yes"], fake)).toBe(1);
      expect(yield* TestConsole.errorLines).toContain(
        "t3-code-kit: no sandbox named 'charprobe': its volume contents may still be on disk. run 'npm run up -- charprobe', then 'npm run nuke -- charprobe'",
      );
    }).pipe(Effect.provide(TestConsole.layer));
  });

  it.effect("rejects --purge", () => {
    const fake = makeFakeSbx();
    return Effect.gen(function* () {
      expect(yield* runCli(["nuke", "--purge"], fake)).toBe(2);
      expect(argsOf(fake)).toEqual([]);
      expect(yield* TestConsole.errorLines).toContain(
        "t3-code-kit: unknown option '--purge' (nuke takes only a sandbox name and --yes)",
      );
    }).pipe(Effect.provide(TestConsole.layer));
  });
});

describe("doctor", () => {
  it.effect("prints the capabilities the seam probed", () => {
    const fake = makeFakeSbx();
    return Effect.gen(function* () {
      expect(yield* runCli(["doctor"], fake)).toBe(0);
      const logs = yield* TestConsole.logLines;
      expect(logs).toContain("sbx capabilities:");
      expect(logs).toContain("  fake 0.0.0");
      expect(logs).toContain("  volumes: unsupported");
      expect(logs).toContain("  rm: force=true purge=false");
      expect(logs).toContain("  egress: deny-by-default");
    }).pipe(Effect.provide(TestConsole.layer));
  });

  it.effect("fails loudly when the probe cannot run", () => {
    const fake = makeFakeSbx({
      capabilitiesError: new SbxCommandError({
        verb: "version",
        exitCode: 1,
        stderr: "sbx is broken\n",
      }),
    });
    return Effect.gen(function* () {
      expect(yield* runCli(["doctor"], fake)).toBe(1);
      const errors = yield* TestConsole.errorLines;
      expect(errors).toContain("sbx is broken");
      expect(errors).toContain("t3-code-kit: could not probe sbx");
    }).pipe(Effect.provide(TestConsole.layer));
  });
});

describe("policy and usage", () => {
  it.effect("prints the runtime allowlist", () => {
    const fake = makeFakeSbx();
    return Effect.gen(function* () {
      expect(yield* runCli(["policy"], fake)).toBe(0);
      const logs = yield* TestConsole.logLines;
      expect(logs).toContain("egress allowed at runtime (everything else denied):");
      expect(logs).toContain("  github.com");
    }).pipe(Effect.provide(TestConsole.layer));
  });

  it.effect("prints usage for help and exits 0", () => {
    const fake = makeFakeSbx();
    return Effect.gen(function* () {
      expect(yield* runCli(["help"], fake)).toBe(0);
      const logs = yield* TestConsole.logLines;
      expect(logs.some((line) => String(line).startsWith("usage:"))).toBe(true);
    }).pipe(Effect.provide(TestConsole.layer));
  });

  it.effect("prints usage for no verb and exits 2", () => {
    const fake = makeFakeSbx();
    return Effect.gen(function* () {
      expect(yield* runCli([], fake)).toBe(2);
    }).pipe(Effect.provide(TestConsole.layer));
  });

  it.effect("rejects an unknown verb", () => {
    const fake = makeFakeSbx();
    return Effect.gen(function* () {
      expect(yield* runCli(["bogus"], fake)).toBe(1);
      expect(yield* TestConsole.errorLines).toContain(
        "t3-code-kit: unknown verb 'bogus' (try: npm run help)",
      );
    }).pipe(Effect.provide(TestConsole.layer));
  });

  it.effect("requires a sandbox name", () => {
    const fake = makeFakeSbx();
    return Effect.gen(function* () {
      expect(yield* runCli(["up"], fake, { ...defaultEnv, T3CK_NAME: "" })).toBe(1);
      expect(yield* TestConsole.errorLines).toContain(
        "t3-code-kit: no sandbox name: pass one, or set T3CK_NAME",
      );
    }).pipe(Effect.provide(TestConsole.layer));
  });
});
