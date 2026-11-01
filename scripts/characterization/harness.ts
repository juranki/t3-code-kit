// The characterization harness: one case table, run against both launchers.
//
// The launchers shell out to `sbx`, so the fake is an executable on PATH, not a
// module. Each case supplies a scenario (what `sbx` answers) and the suite
// records the argv sequence, exit code, and warnings that came back. The
// golden files are the contract; output wording may change, argv may not.
//
// ps1 is the launcher people actually use, so its run is the reference. A case
// whose sh behaviour differs carries a `sh` reason, and the golden records the
// two sequences separately rather than pretending they match.
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

export type LauncherName = "sh" | "ps1";

export interface Rule {
  /** Argv prefix; `*` matches any single word. */
  match?: string[];
  stdout?: string;
  stderr?: string;
  exit?: number;
}

export interface Scenario {
  calls?: Rule[];
  default?: Rule;
}

export interface Case {
  /** Test title and golden filename. */
  name: string;
  /** Sandbox name the case runs under. Defaults to `charprobe`. */
  sandbox?: string;
  args: string[];
  env?: Record<string, string>;
  scenario: Scenario;
  /** Substrings that must appear in stdout, after normalization. */
  stdout?: string[];
  /** Whether ps1's readiness probe needs a live server. */
  server?: boolean;
  /** Set when sh's argv legitimately differs from ps1's. */
  sh?: { reason: string };
}

export interface Golden {
  exit: number;
  calls: string[][];
  warnings: string[];
  sh?: {
    exit: number;
    calls: string[][];
    warnings: string[];
    reason: string;
  };
}

export interface RunResult {
  exit: number;
  stdout: string;
  stderr: string;
  calls: string[][];
  warnings: string[];
}

export interface Fixtures {
  dir: string;
  bin: string;
  sbx: string;
  log: string;
}

interface NormalizeContext {
  name: string;
  port: number;
  kit: string;
  root: string;
  temp: string;
}

export const root = join(import.meta.dirname, "..", "..");

const shLauncher = join(root, "bin", "t3-code-kit");
const psLauncher = join(root, "bin", "t3-code-kit.ps1");

let pwshAvailable: boolean | undefined;

export function launcherAvailable(name: LauncherName): boolean {
  if (name === "sh") return process.platform !== "win32";
  if (pwshAvailable === undefined) {
    const probe = spawnSync("pwsh", ["-NoProfile", "-Command", "exit 0"], {
      stdio: "ignore",
    });
    pwshAvailable = probe.status === 0;
  }
  return pwshAvailable;
}

export function slug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export function makeFixtures(): Fixtures {
  const dir = mkdtempSync(join(tmpdir(), "t3ck-characterization-"));
  const bin = join(dir, "bin");
  mkdirSync(bin);

  const fixtures = [
    ["sbx", "fake-sbx.mjs"],
    ["git", "fake-git.mjs"],
    ["curl", "fake-curl.mjs"],
    ["sleep", "fake-sleep.mjs"],
  ] as const;

  for (const [name, file] of fixtures) {
    const source = join(import.meta.dirname, file);
    if (process.platform === "win32") {
      // sbx gets a PowerShell shim, not a .cmd: the identity call carries
      // `$(printf %s '<b64>' | base64 -d)` as one argument, and cmd.exe
      // re-parses the `|` and `$` before the fake ever sees them. git's
      // arguments are plain words, so the cheaper .cmd shim is fine there.
      if (name === "sbx") {
        writeFileSync(join(bin, "sbx.ps1"), `& node "${source}" @args\nexit $LASTEXITCODE\n`);
      } else {
        writeFileSync(join(bin, `${name}.cmd`), `@echo off\r\nnode "${source}" %*\r\n`);
      }
    } else {
      // A wrapper, not a copy: an extensionless copy would be treated as
      // CommonJS and choke on the fixture's `import` statements.
      const target = join(bin, name);
      writeFileSync(target, `#!/bin/sh\nexec node "${source}" "$@"\n`);
      chmodSync(target, 0o755);
    }
  }

  const sbx = process.platform === "win32" ? join(bin, "sbx.ps1") : join(bin, "sbx");
  return { dir, bin, sbx, log: join(dir, "sbx.log") };
}

export function withServer<T>(fn: (port: number) => Promise<T>): Promise<T> {
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/plain" });
    response.end("ok");
  });

  return new Promise<T>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, async () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      try {
        resolve(await fn(port));
      } catch (error) {
        reject(error);
      } finally {
        server.close();
      }
    });
  });
}

export async function runCase(
  fixtures: Fixtures,
  launcher: LauncherName,
  testCase: Case,
  port: number,
): Promise<RunResult> {
  const name = testCase.sandbox ?? "charprobe";
  const id = `${launcher}-${slug(testCase.name)}`;
  const scenarioPath = join(fixtures.dir, `scenario-${id}.json`);
  const logPath = join(fixtures.dir, `log-${id}.jsonl`);

  writeFileSync(scenarioPath, `${JSON.stringify(render(testCase.scenario, port), null, 2)}\n`);
  writeFileSync(logPath, "");

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${fixtures.bin}${delimiter}${process.env.PATH ?? ""}`,
    SBX: fixtures.sbx,
    FAKE_SBX_SCENARIO: scenarioPath,
    FAKE_SBX_LOG: logPath,
    FAKE_GIT_NAME: "Test User",
    FAKE_GIT_EMAIL: "test@example.com",
    FAKE_CURL_EXIT: "0",
    T3CK_NAME: name,
    T3CK_PORT: String(port),
    // A server-backed case must actually probe once; a case that expects the
    // timeout keeps the loop from running at all.
    T3CK_READY_TIMEOUT: testCase.server ? "5" : "0",
    T3CK_AGENT_NAME_PREFIX: "Agent for ",
    ...testCase.env,
  };

  const [file, args] =
    launcher === "sh"
      ? ["sh", [shLauncher, ...testCase.args]]
      : ["pwsh", ["-NoProfile", "-File", psLauncher, ...testCase.args]];

  const raw = await spawnCapture(file, args, env);
  const context: NormalizeContext = {
    name,
    port,
    kit: join(root, "kit"),
    root,
    temp: fixtures.dir,
  };

  const calls = readFileSync(logPath, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) =>
      (JSON.parse(line) as { argv: string[] }).argv.map((word) => normalizeText(word, context)),
    );

  const stderr = normalizeText(raw.stderr, context);

  return {
    exit: raw.code,
    stdout: normalizeText(raw.stdout, context),
    stderr,
    calls,
    warnings: extractWarnings(stderr),
  };
}

function spawnCapture(
  file: string,
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(file, args, { env, cwd: root, timeout: 30_000 });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
    child.on("error", (error) =>
      resolve({ code: -1, stdout, stderr: `${stderr}${error.message}` }),
    );
  });
}

function render(value: unknown, port: number): unknown {
  if (typeof value === "string") return value.replaceAll("{{port}}", String(port));
  if (Array.isArray(value)) return value.map((item) => render(item, port));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, render(item, port)]),
    );
  }
  return value;
}

function normalizeText(text: string, context: NormalizeContext): string {
  let out = text;
  out = out.replaceAll(context.temp, "<tmp>");
  out = out.replaceAll(context.kit, "<kit>");
  out = out.replaceAll(context.root, "<root>");
  out = out.replaceAll(context.name, "<name>");
  out = out.replaceAll(String(context.port), "<port>");
  out = out.replaceAll("t3-code-kit.ps1", "t3-code-kit");
  // The twins differ only in this dash in the serve.log warning; normalize it
  // so a wording difference does not read as a behavioural one.
  out = out.replaceAll("—", "-");
  out = out.replace(/'([A-Za-z0-9+/=]{8,})' \| base64 -d/g, (_match, encoded: string) => {
    const decoded = Buffer.from(encoded, "base64").toString("utf8");
    return `'<b64:${decoded}>'`;
  });
  return out;
}

function extractWarnings(stderr: string): string[] {
  return stderr
    .split(/\r?\n/)
    .map((line) => line.trim())
    .flatMap((line) => {
      if (line.startsWith("⚠️")) return [line.replace(/^⚠️\s*/, "")];
      if (line.startsWith("WARNING:")) return [line.replace(/^WARNING:\s*/, "")];
      if (line.startsWith("t3-code-kit:")) return [line.replace(/^t3-code-kit:\s*/, "")];
      return [];
    });
}

const secretPresent: Rule = {
  match: ["secret", "ls"],
  stdout: "SCOPE  TYPE   NAME    SECRET\nglobal api    github  ****\n",
};

const secretAbsent: Rule = {
  match: ["secret", "ls"],
  stdout: "SCOPE  TYPE   NAME        SECRET\nglobal api    anthropic   ****\n",
};

const secretNearMiss: Rule = {
  match: ["secret", "ls"],
  stdout: "SCOPE  TYPE   NAME               SECRET\nglobal api    github-enterprise  ****\n",
};

const secretUnknown: Rule = { match: ["secret", "ls"], exit: 1 };

const notExists: Rule = { match: ["ls"], stdout: "other\n" };
const exists: Rule = { match: ["ls"], stdout: "charprobe\n" };
const createOk: Rule = { match: ["create"], exit: 0 };
const runOk: Rule = { match: ["run"], exit: 0 };
const identityOk: Rule = { match: ["exec", "*", "--", "sh", "-c"], exit: 0 };

const pairOk: Rule = {
  match: ["exec", "*", "--", "t3", "pair"],
  stdout: "http://10.0.0.1:9999/pair#token=abc123\n",
};

const portsPublished: Rule = {
  match: ["ports", "*"],
  stdout: "127.0.0.1:{{port}}->3773/tcp\n",
};

const upCreateCalls = [notExists, secretPresent, createOk, runOk, identityOk, pairOk];
const upExistingCalls = [exists, secretPresent, runOk, portsPublished, identityOk, pairOk];

const url = "http://localhost:<port>/pair#token=abc123";

export const CASES: Case[] = [
  {
    name: "help",
    args: ["help"],
    scenario: {},
    stdout: ["usage:", "up"],
  },
  {
    name: "help flag",
    args: ["--help"],
    scenario: {},
    sh: {
      reason:
        "ps1 binds `--help` as a PowerShell parameter and exits 1; sh prints usage and exits 0. The v2 CLI should follow sh.",
    },
  },
  {
    name: "no args",
    args: [],
    scenario: {},
    stdout: ["usage:", "up"],
  },
  {
    name: "unknown verb",
    args: ["bogus"],
    scenario: {},
    sh: { reason: "ps1 points at `help`; sh points at `--help`." },
  },
  {
    name: "missing name",
    args: ["up"],
    env: { T3CK_NAME: "" },
    scenario: {},
  },
  {
    name: "policy",
    args: ["policy"],
    scenario: {},
    stdout: ["egress allowed at runtime", "github.com"],
  },
  {
    name: "up create",
    args: ["up"],
    scenario: { calls: upCreateCalls },
    stdout: ["server is up.", url],
    server: true,
  },
  {
    name: "up create with explicit name",
    sandbox: "othername",
    args: ["up", "othername"],
    env: { T3CK_NAME: "charprobe" },
    scenario: { calls: upCreateCalls },
    stdout: [url],
    server: true,
  },
  {
    name: "up existing",
    args: ["up"],
    scenario: { calls: upExistingCalls },
    stdout: ["server is up.", url],
    server: true,
  },
  {
    name: "up existing port not published",
    args: ["up"],
    scenario: {
      calls: [
        exists,
        secretPresent,
        runOk,
        { match: ["ports", "*", "--publish"], exit: 0 },
        { match: ["ports", "*"], stdout: "" },
        identityOk,
        pairOk,
      ],
    },
    stdout: [url],
    server: true,
  },
  {
    name: "up existing port publish fails",
    args: ["up"],
    scenario: {
      calls: [
        exists,
        secretPresent,
        runOk,
        { match: ["ports", "*", "--publish"], exit: 1 },
        { match: ["ports", "*"], stdout: "" },
        identityOk,
        pairOk,
      ],
    },
    stdout: [url],
    server: true,
  },
  {
    name: "up create fails",
    args: ["up"],
    scenario: {
      calls: [notExists, secretPresent, { match: ["create"], exit: 1, stderr: "build failed\n" }],
    },
  },
  {
    name: "up create ok run fails",
    args: ["up"],
    scenario: {
      calls: [
        notExists,
        secretPresent,
        createOk,
        { match: ["run"], exit: 1, stderr: "run failed\n" },
      ],
    },
  },
  {
    name: "up secret absent",
    args: ["up"],
    scenario: { calls: [notExists, secretAbsent, createOk, runOk, identityOk, pairOk] },
    stdout: [url],
    server: true,
  },
  {
    name: "up secret near miss",
    args: ["up"],
    scenario: { calls: [notExists, secretNearMiss, createOk, runOk, identityOk, pairOk] },
    stdout: [url],
    server: true,
  },
  {
    name: "up secret unknown",
    args: ["up"],
    scenario: { calls: [notExists, secretUnknown, createOk, runOk, identityOk, pairOk] },
    stdout: [url],
    server: true,
  },
  {
    name: "up identity exec fails",
    args: ["up"],
    scenario: {
      calls: [
        notExists,
        secretPresent,
        createOk,
        runOk,
        { match: ["exec", "*", "--", "sh", "-c"], exit: 1 },
        pairOk,
      ],
    },
    stdout: [url],
    server: true,
  },
  {
    name: "up host git absent",
    args: ["up"],
    env: { FAKE_GIT_NAME: "", FAKE_GIT_EMAIL: "" },
    scenario: { calls: upCreateCalls },
    stdout: [url],
    server: true,
  },
  {
    name: "up empty agent prefix",
    args: ["up"],
    env: { T3CK_AGENT_NAME_PREFIX: "" },
    scenario: { calls: upCreateCalls },
    stdout: [url],
    server: true,
  },
  {
    name: "up ready timeout",
    args: ["up"],
    env: { T3CK_READY_TIMEOUT: "0", FAKE_CURL_EXIT: "1" },
    scenario: { calls: upCreateCalls },
    stdout: [url],
  },
  {
    name: "url",
    args: ["url"],
    scenario: { calls: [pairOk] },
    stdout: [url],
  },
  {
    name: "url fallback",
    args: ["url"],
    scenario: {
      calls: [
        { match: ["exec", "*", "--", "t3", "pair"], stdout: "" },
        {
          match: ["exec", "*", "--", "sh", "-c"],
          stdout: "Pairing URL: http://10.0.0.1:9999/pair#token=abc123\n",
        },
        {
          match: ["exec", "*", "--", "tail", "-n", "500", "/home/agent/.t3/serve.log"],
          stdout: "Pairing URL: http://10.0.0.1:9999/pair#token=abc123\n",
        },
      ],
    },
    stdout: [url],
    sh: { reason: "sh reads the pairing URL with `sh -c grep`; ps1 uses `tail -n 500`." },
  },
  {
    name: "url no pairing url",
    args: ["url"],
    scenario: {
      calls: [
        { match: ["exec", "*", "--", "t3", "pair"], stdout: "" },
        { match: ["exec", "*", "--", "sh", "-c"], stdout: "" },
        {
          match: ["exec", "*", "--", "tail", "-n", "500", "/home/agent/.t3/serve.log"],
          stdout: "",
        },
      ],
    },
    sh: { reason: "sh reads the pairing URL with `sh -c grep`; ps1 uses `tail -n 500`." },
  },
  {
    name: "logs",
    args: ["logs"],
    scenario: {
      calls: [
        {
          match: ["exec", "*", "--", "tail", "-n", "200", "/home/agent/.t3/serve.log"],
          stdout: "log line\n",
        },
      ],
    },
    stdout: ["log line"],
  },
  {
    name: "logs line count",
    args: ["logs", "charprobe", "50"],
    scenario: {
      calls: [
        {
          match: ["exec", "*", "--", "tail", "-n", "50", "/home/agent/.t3/serve.log"],
          stdout: "log line\n",
        },
      ],
    },
    stdout: ["log line"],
  },
  {
    name: "logs fallback",
    args: ["logs"],
    scenario: {
      calls: [
        { match: ["exec", "*", "--", "tail", "-n", "200", "/home/agent/.t3/serve.log"], exit: 1 },
        {
          match: ["exec", "*", "--", "tail", "-n", "200", "/var/log/sbx-kit-startup.log"],
          stdout: "startup line\n",
        },
      ],
    },
    stdout: ["startup line"],
  },
  {
    name: "logs both fail",
    args: ["logs"],
    scenario: {
      calls: [
        { match: ["exec", "*", "--", "tail", "-n", "200", "/home/agent/.t3/serve.log"], exit: 1 },
        {
          match: ["exec", "*", "--", "tail", "-n", "200", "/var/log/sbx-kit-startup.log"],
          exit: 1,
        },
      ],
    },
  },
  {
    name: "shell",
    args: ["shell"],
    scenario: { calls: [{ match: ["exec", "-it", "*", "--", "bash"], exit: 0 }] },
  },
  {
    name: "shell attach fallback",
    args: ["shell"],
    scenario: {
      calls: [
        { match: ["exec", "-it", "*", "--", "bash"], exit: 1 },
        { match: ["attach", "*"], exit: 0 },
      ],
    },
  },
  {
    name: "refresh",
    args: ["refresh"],
    scenario: {
      calls: [
        { match: ["stop", "*"], exit: 0 },
        exists,
        secretPresent,
        runOk,
        portsPublished,
        identityOk,
        pairOk,
      ],
    },
    stdout: [url],
    server: true,
  },
  {
    name: "refresh stop fails",
    args: ["refresh"],
    scenario: { calls: [{ match: ["stop", "*"], exit: 1, stderr: "stop failed\n" }] },
  },
  {
    name: "down",
    args: ["down"],
    scenario: { calls: [{ match: ["stop", "*"], exit: 0 }] },
  },
  {
    name: "down stop fails",
    args: ["down"],
    scenario: { calls: [{ match: ["stop", "*"], exit: 1, stderr: "stop failed\n" }] },
    sh: {
      reason: "sh exits 1 on a failed stop without a message; ps1 prints `could not stop`.",
    },
  },
  {
    name: "rebuild",
    args: ["rebuild"],
    scenario: {
      calls: [
        { match: ["rm", "--force", "*"], exit: 0 },
        notExists,
        secretPresent,
        createOk,
        runOk,
        identityOk,
        pairOk,
      ],
    },
    stdout: [url],
    server: true,
  },
  {
    name: "rebuild rm fails",
    args: ["rebuild"],
    scenario: {
      calls: [
        { match: ["rm", "--force", "*"], exit: 1, stderr: "rm failed\n" },
        notExists,
        secretPresent,
        createOk,
        runOk,
        identityOk,
        pairOk,
      ],
    },
    stdout: [url],
    server: true,
  },
  {
    name: "nuke",
    args: ["nuke"],
    scenario: {
      calls: [
        { match: ["rm", "--force", "*"], exit: 0 },
        { match: ["volume", "ls"], stdout: "vol1 charprobe\nvol2 other\n" },
        { match: ["volume", "rm", "vol1"], exit: 0 },
      ],
    },
    stdout: ["removing volume vol1", "done."],
  },
  {
    name: "nuke rm fails",
    args: ["nuke"],
    scenario: {
      calls: [
        { match: ["rm", "--force", "*"], exit: 1, stderr: "rm failed\n" },
        { match: ["volume", "ls"], stdout: "vol1 charprobe\n" },
        { match: ["volume", "rm", "vol1"], exit: 0 },
      ],
    },
    stdout: ["removing volume vol1", "done."],
  },
  {
    name: "nuke volume unsupported",
    args: ["nuke"],
    scenario: {
      calls: [
        { match: ["rm", "--force", "*"], exit: 0 },
        { match: ["volume", "ls"], exit: 1 },
      ],
    },
    stdout: ["done."],
  },
  {
    name: "nuke volume rm fails",
    args: ["nuke"],
    scenario: {
      calls: [
        { match: ["rm", "--force", "*"], exit: 0 },
        { match: ["volume", "ls"], stdout: "vol1 charprobe\n" },
        { match: ["volume", "rm", "vol1"], exit: 1 },
      ],
    },
    stdout: ["removing volume vol1", "done."],
  },
  {
    name: "nuke no matching volume",
    args: ["nuke"],
    scenario: {
      calls: [
        { match: ["rm", "--force", "*"], exit: 0 },
        { match: ["volume", "ls"], stdout: "vol2 other\n" },
      ],
    },
    stdout: ["done."],
  },
];
