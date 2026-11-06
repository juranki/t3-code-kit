// The seam: a typed `Sbx` service built over a tiny adapter. The service owns
// argv construction, output parsing, and the error taxonomy; the adapter owns
// the process (live) or the script (fake).
//
// Exit codes are data for the verbs that ask a question (`exec`, `ports`,
// `run`, `stop`, `create`, `attach`); `execChecked` is for a caller that wants
// a non-zero exit to be a failure. A missing sandbox is always a typed failure,
// because "it is gone" is a different decision from "it said no".
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import type { Capabilities } from "./capabilities.ts";
import { command, type Command } from "./command.ts";
import {
  EgressBlockedError,
  SandboxExistsError,
  SandboxMissingError,
  SbxCommandError,
  SbxNotLoggedInError,
  SbxNotFoundError,
  SbxOutputError,
  SbxTimeoutError,
} from "./errors.ts";
import { bound, isMissingSandbox, isNotLoggedIn, verbOf } from "./support.ts";

/** One published mapping, as `sbx ls --json` reports it. */
export interface SandboxPort {
  readonly hostIp: string;
  readonly hostPort: number;
  readonly sandboxPort: number;
  readonly protocol: string;
}

/** One row of `sbx ls --json`. The listing also carries `id`, `cpus`,
 * `memory`, `last_used_at`, and `detached`; none of them is a decision the CLI
 * makes, so the seam does not model them. */
export interface SandboxSummary {
  readonly name: string;
  readonly agent: string;
  readonly status: string;
  readonly ports: ReadonlyArray<SandboxPort>;
  readonly createdAt: string;
}

export interface PortMapping {
  readonly hostPort: number;
  readonly containerPort: number;
}

export interface SecretRow {
  readonly scope: string;
  readonly type: string;
  readonly name: string;
}

export interface ExecResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

/** What the adapter returns. A non-zero exit is data here; the service decides
 * whether that is an error. */
export interface RawResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

export interface EgressResult {
  readonly status: number;
  readonly body: string;
}

export interface CreateInput {
  readonly name: string;
  readonly kitDir: string;
  readonly publish?: PortMapping;
  readonly env?: Readonly<Record<string, string | undefined>>;
}

export interface ExecInput {
  readonly name: string;
  /** The command inside the sandbox. A multi-line script is one element:
   * `["sh", "-c", script]`, never a joined string. */
  readonly argv: ReadonlyArray<string>;
  readonly tty?: boolean;
  /** Run as this user inside the sandbox (`sbx exec -u`). `nuke` needs root
   * to delete the root-owned `.sbx-volume-initialized` and `lost+found`
   * entries on a volume. */
  readonly user?: string;
  readonly timeoutMs?: number;
}

export interface PortsInput {
  readonly name: string;
  readonly publish?: PortMapping;
}

export interface RmInput {
  readonly name: string;
  readonly force: boolean;
}

/** A command that never ran, timed out, or failed in the binary itself. */
export type SbxError = SbxCommandError | SbxTimeoutError | SbxNotFoundError;

/** The only thing a live and a fake implementation have to provide. It is a
 * service, not a `make` parameter, so the layer's `R` says what the seam needs. */
export class Adapter extends Context.Service<
  Adapter,
  {
    readonly run: (command: Command) => Effect.Effect<RawResult, SbxError>;
    readonly capabilities: Effect.Effect<Capabilities, SbxError>;
  }
>()("@t3ck/sbx/Sbx/Adapter") {}

export class Sbx extends Context.Service<
  Sbx,
  {
    readonly probe: () => Effect.Effect<Capabilities, SbxError>;
    readonly list: () => Effect.Effect<ReadonlyArray<SandboxSummary>, SbxError | SbxOutputError>;
    readonly create: (
      input: CreateInput,
    ) => Effect.Effect<ExecResult, SbxError | SandboxExistsError>;
    readonly run: (input: { readonly name: string }) => Effect.Effect<ExecResult, SbxError>;
    readonly stop: (input: { readonly name: string }) => Effect.Effect<ExecResult, SbxError>;
    readonly ports: (input: PortsInput) => Effect.Effect<ExecResult, SbxError>;
    /** Exit code is data: a probe asks a question with `exec` ("is this a
     * mountpoint?"). A missing sandbox is still a typed failure. */
    readonly exec: (input: ExecInput) => Effect.Effect<ExecResult, SbxError | SandboxMissingError>;
    /** Fails on a non-zero exit: a verb asks `sbx` to do something. */
    readonly execChecked: (
      input: ExecInput,
    ) => Effect.Effect<ExecResult, SbxError | SandboxMissingError>;
    readonly attach: (input: {
      readonly name: string;
    }) => Effect.Effect<ExecResult, SbxError | SandboxMissingError>;
    readonly rm: (input: RmInput) => Effect.Effect<ExecResult, SbxError | SandboxMissingError>;
    /** A failure means "we never saw the listing", not "no secret". The old
     * three-outcome rule from the old shell test, as the failure channel. */
    readonly secrets: () => Effect.Effect<
      ReadonlyArray<SecretRow>,
      SbxError | SbxOutputError | SbxNotLoggedInError
    >;
    readonly probeEgress: (input: {
      readonly name: string;
      readonly url: string;
    }) => Effect.Effect<
      EgressResult,
      SbxError | SandboxMissingError | EgressBlockedError | SbxOutputError
    >;
  }
>()("@t3ck/sbx/Sbx") {}

// The first `create` builds the Kit image: 10-25 minutes on a cold host, plus
// the base-image pull. The old launchers had no bound at all; this is a bound
// that cannot fire during a real build, not a 60-second default that turns it
// into a timeout.
const CREATE_TIMEOUT_MS = 60 * 60_000;

interface SbxCommandOptions {
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly tty?: boolean;
  readonly timeoutMs?: number;
  /** `attach` and an interactive `exec -it` must keep sbx's own prompts. */
  readonly interactive?: boolean;
}

// `--no-input` (a global flag since sbx 0.51.0) turns a prompt into an error
// naming the command to run. Without it a prompt waits on stdin until the
// command's timeout, and `create`'s is an hour. It goes before the verb because
// that is where sbx's global flags live; for `exec` it cannot go after `--`,
// where the words belong to the sandbox.
const sbxCommand = (args: ReadonlyArray<string>, options: SbxCommandOptions = {}): Command => {
  const { interactive = false, ...rest } = options;
  return command({
    bin: "sbx",
    args: interactive ? args : ["--no-input", ...args],
    ...rest,
  });
};

const runChecked = (
  adapter: Adapter["Service"],
  input: Command,
): Effect.Effect<RawResult, SbxError> =>
  adapter.run(input).pipe(
    Effect.filterOrFail(
      (result) => result.exitCode === 0,
      (result) =>
        new SbxCommandError({
          verb: verbOf(input),
          exitCode: result.exitCode,
          stderr: bound(result.stderr),
        }),
    ),
  );

const missingSandbox = (input: ExecResult, name: string, verb: string) =>
  input.exitCode !== 0 && isMissingSandbox(input.stderr)
    ? Effect.fail(new SandboxMissingError({ sandboxName: name, verb }))
    : Effect.succeed(input);

const make = Effect.gen(function* () {
  const adapter = yield* Adapter;

  const probe = Effect.fn("Sbx.probe")(function* () {
    return yield* adapter.capabilities;
  });

  const list = Effect.fn("Sbx.list")(function* () {
    const result = yield* runChecked(adapter, sbxCommand(["ls", "--json"]));
    return yield* Effect.try({
      try: () => parseSandboxList(result.stdout),
      catch: () => new SbxOutputError({ verb: "ls", field: "sandbox rows" }),
    });
  });

  const create = Effect.fn("Sbx.create")(function* (input: CreateInput) {
    const result = yield* adapter.run(
      sbxCommand(
        [
          "create",
          "--name",
          input.name,
          ...(input.publish === undefined
            ? []
            : ["-p", `127.0.0.1:${input.publish.hostPort}:${input.publish.containerPort}`]),
          input.kitDir,
        ],
        {
          timeoutMs: CREATE_TIMEOUT_MS,
          ...(input.env === undefined ? {} : { env: input.env }),
        },
      ),
    );
    // Only a name conflict is `SandboxExistsError`. A port conflict also
    // contains "conflict" in some sbx builds, and reporting it as "a sandbox
    // named X already exists" would send the user looking for the wrong thing.
    // Captured from sbx v0.50.1 on Windows, exit 1
    // (`docs/research/sbx-probe-2026-11-01.log`):
    //   error: sandbox 't3ck-probe' already exists; connect to the existing sandbox
    //     try: sbx run --name t3ck-probe
    if (result.exitCode !== 0 && /already exists/iu.test(result.stderr)) {
      return yield* new SandboxExistsError({ sandboxName: input.name });
    }
    return result;
  });

  const run = Effect.fn("Sbx.run")(function* (input: { readonly name: string }) {
    return yield* adapter.run(sbxCommand(["run", "-d", "--name", input.name]));
  });

  const stop = Effect.fn("Sbx.stop")(function* (input: { readonly name: string }) {
    return yield* adapter.run(sbxCommand(["stop", input.name]));
  });

  const ports = Effect.fn("Sbx.ports")(function* (input: PortsInput) {
    return yield* adapter.run(
      sbxCommand([
        "ports",
        input.name,
        ...(input.publish === undefined
          ? []
          : ["--publish", `127.0.0.1:${input.publish.hostPort}:${input.publish.containerPort}`]),
      ]),
    );
  });

  const exec = Effect.fn("Sbx.exec")(function* (input: ExecInput) {
    const result = yield* adapter.run(
      sbxCommand(
        [
          "exec",
          ...(input.tty === true ? ["-it"] : []),
          ...(input.user === undefined ? [] : ["-u", input.user]),
          input.name,
          "--",
          ...input.argv,
        ],
        {
          ...(input.tty === undefined ? {} : { tty: input.tty }),
          ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
          interactive: input.tty === true,
        },
      ),
    );
    return yield* missingSandbox(result, input.name, "exec");
  });

  const execChecked = Effect.fn("Sbx.execChecked")(function* (input: ExecInput) {
    const result = yield* exec(input);
    if (result.exitCode === 0) return result;
    return yield* new SbxCommandError({
      verb: "exec",
      exitCode: result.exitCode,
      stderr: bound(result.stderr),
    });
  });

  const attach = Effect.fn("Sbx.attach")(function* (input: { readonly name: string }) {
    const result = yield* adapter.run(
      sbxCommand(["attach", input.name], { tty: true, interactive: true }),
    );
    return yield* missingSandbox(result, input.name, "attach");
  });

  const rm = Effect.fn("Sbx.rm")(function* (input: RmInput) {
    const result = yield* adapter.run(
      sbxCommand(["rm", ...(input.force ? ["--force"] : []), input.name]),
    );
    return yield* missingSandbox(result, input.name, "rm");
  });

  const secrets = Effect.fn("Sbx.secrets")(function* () {
    const result = yield* adapter.run(sbxCommand(["secret", "ls"]));
    if (result.exitCode !== 0) {
      if (isNotLoggedIn(result.stderr)) {
        return yield* new SbxNotLoggedInError({});
      }
      return yield* new SbxCommandError({
        verb: "secret ls",
        exitCode: result.exitCode,
        stderr: bound(result.stderr),
      });
    }
    return yield* Effect.try({
      try: () => parseSecretRows(result.stdout),
      catch: () => new SbxOutputError({ verb: "secret ls", field: "secret rows" }),
    });
  });

  const probeEgress = Effect.fn("Sbx.probeEgress")(function* (input: {
    readonly name: string;
    readonly url: string;
  }) {
    const result = yield* exec({
      name: input.name,
      argv: ["curl", "-sS", "-w", "\\n%{http_code}", input.url],
    });
    const [body, statusText] = splitStatus(result.stdout);
    const status = Number.parseInt(statusText, 10);
    if (!Number.isInteger(status)) {
      return yield* new SbxOutputError({ verb: "exec", field: "egress status" });
    }
    if (status === 403) {
      return yield* new EgressBlockedError({ host: hostOf(input.url) });
    }
    return { status, body };
  });

  return Sbx.of({
    probe,
    list,
    create,
    run,
    stop,
    ports,
    exec,
    execChecked,
    attach,
    rm,
    secrets,
    probeEgress,
  });
});

export const layer: Layer.Layer<Sbx, never, Adapter> = Layer.effect(Sbx, make);

// --- parsers ---------------------------------------------------------------
// `sbx` has JSON output for `ls` and not for the rest. A parser throws on
// output it cannot read, and `SbxOutputError` is the "sbx moved under us"
// signal.

// `sbx ls --json` prints an array of objects. The shape below was captured from
// `sbx` v0.51.0 on Windows; the table it replaced was fixed-width and had to be
// sliced by header offsets, which broke as soon as a column moved.
//
//   [{ "name": "t3", "agent": "kit", "status": "running",
//      "ports": [{ "host_ip": "127.0.0.1", "host_port": 3773,
//                  "sandbox_port": 3773, "protocol": "tcp4" }],
//      "created_at": "2026-11-06T18:17:57Z", "detached": true, ... }]
const SandboxPortJson = Schema.Struct({
  host_ip: Schema.String,
  host_port: Schema.Number,
  sandbox_port: Schema.Number,
  protocol: Schema.String,
});

const SandboxJson = Schema.Struct({
  name: Schema.String,
  agent: Schema.String,
  status: Schema.String,
  ports: Schema.optionalKey(Schema.Array(SandboxPortJson)),
  created_at: Schema.String,
});

const SandboxListJson = Schema.fromJsonString(Schema.Array(SandboxJson));

export const parseSandboxList = (stdout: string): ReadonlyArray<SandboxSummary> =>
  Schema.decodeSync(SandboxListJson)(stdout).map((row) => ({
    name: row.name,
    agent: row.agent,
    status: row.status,
    ports: (row.ports ?? []).map((port) => ({
      hostIp: port.host_ip,
      hostPort: port.host_port,
      sandboxPort: port.sandbox_port,
      protocol: port.protocol,
    })),
    createdAt: row.created_at,
  }));

/** The host ports already published for a sandbox. `sbx ports` prints a table
 * (`HOST IP / HOST PORT / SANDBOX PORT / PROTOCOL`); the CLI asks one question
 * — "is this host port already published?" — so only the host-port column is
 * read. */
export const publishedHostPorts = (stdout: string): ReadonlyArray<number> => {
  const ports: Array<number> = [];
  for (const line of stdout.split(/\r?\n/u)) {
    const columns = line.trim().split(/\s+/u);
    if (columns.length < 4 || !/^\d+$/u.test(columns[1] ?? "")) continue;
    const port = Number.parseInt(columns[1] ?? "", 10);
    if (Number.isInteger(port)) ports.push(port);
  }
  return ports;
};

export const parseSecretRows = (stdout: string): ReadonlyArray<SecretRow> =>
  stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !/^scope\b/iu.test(line))
    .map((line) => {
      const [scope, type, name] = line.split(/\s+/u);
      if (scope === undefined || type === undefined || name === undefined) {
        throw new Error("short secret row");
      }
      return { scope, type, name };
    });

/** `curl -w '\n%{http_code}'` puts the status on the last line. */
export const splitStatus = (stdout: string): readonly [string, string] => {
  const index = stdout.lastIndexOf("\n");
  return index < 0 ? [stdout, ""] : [stdout.slice(0, index), stdout.slice(index + 1).trim()];
};

export const hostOf = (url: string): string => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};
