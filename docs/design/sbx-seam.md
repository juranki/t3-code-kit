# The `Sbx` seam: design record

The settled design from [Design the Sbx seam](https://github.com/juranki/t3-code-kit/issues/35).
The production module is [`packages/sbx/`](../../packages/sbx/src/Sbx.ts); the
throwaway prototype that this note was written against lived on
`t3/design-sbx-seam-map-29`, was never merged, and has been deleted. What
follows is the reasoning and the `sbx` quirks the seam exists to hide, kept
because the issue that produced it links here.

## The question

What is the smallest interface that hides `sbx`'s quirks and gives the CLI a
testable seam?

The prototype answers with a `Sbx` service whose methods are the verbs the CLI
needs, an `Adapter` that is the only thing a live and a fake implementation
have to provide, and a `Command` value that is data — never a shell string.

## Reading the prototype

The prototype's `demo.ts` and its isolated `tsconfig.json` went with the branch.
The equivalent today is `packages/sbx/src/fake.ts` (a scripted adapter that
records the commands the seam built) and the verb tests in
`apps/cli/src/verbs.test.ts`, which assert the decisions a verb makes rather
than the stderr it prints.

## The shape

```
CLI verb ──► Sbx service ──► Adapter ──► live: ChildProcessSpawner + HostProcess
                              │
                              └────────► fake: scripted responses + recorded commands
```

- **`Sbx`** (`Sbx.ts`) owns argv construction, output parsing, and the error
  taxonomy. It is a `Context.Service`, so a verb test provides a fake and
  asserts decisions, not stderr text.
- **`Adapter`** is two things: `run(command)` and `capabilities`. That is the
  whole surface a live and a fake implementation share.
- **`Command`** (`command.ts`) is `{ bin, args, env, cwd, tty, timeoutMs }`.
  The seam never joins argv into a string. A multi-line wipe script is one
  element, `["sh", "-c", script]`; a git name with a space is one element; a URL
  with `&` is one element.
- **`Capabilities`** (`capabilities.ts`) is what the probe learned: local vs
  cloud, volume support, `rm`/purge semantics, egress model, secrets. The probe
  is where `sbx`'s quirks are named once.

## Methods

| Method        | Returns            | Notes                                                                                      |
| ------------- | ------------------ | ------------------------------------------------------------------------------------------ |
| `probe`       | `Capabilities`     | Runs `sbx version` and `sbx rm --help`; no destructive command.                            |
| `list`        | `SandboxSummary[]` | Runs `sbx ls --json`; the listing is decoded, not sliced. Confirmed against v0.51.0.       |
| `create`      | `ExecResult`       | `sbx create --name <n> [-p 127.0.0.1:h:c] <kit>`; `SandboxExistsError` on a name conflict. |
| `exec`        | `ExecResult`       | Exit code is data. A missing sandbox is a typed failure.                                   |
| `execChecked` | `ExecResult`       | Fails on a non-zero exit. A verb asks `sbx` to do something.                               |
| `rm`          | `void`             | `sbx rm [--force] <n>`; `SandboxMissingError` is distinct.                                 |
| `secrets`     | `SecretRow[]`      | A failure means "we never saw the listing", not "no secret".                               |
| `probeEgress` | `EgressResult`     | Runs `curl` inside the sandbox; a 403 becomes `EgressBlockedError`.                        |

**No `volumes` method.** `sbx volume` is cloud-only and `rm` has no
`--purge`/`--volumes`, so a local seam has nothing to wrap. The capability is
`Capabilities.volumes`, and `nuke` uses `exec` + `rm` + `list` (ADR 0003).

## Errors

All `Schema.TaggedError`, with structured attributes and a message built from
them. The tag is the contract; `stderr` is an attribute, never the switch.

| Tag                      | When                                                                                   |
| ------------------------ | -------------------------------------------------------------------------------------- |
| `SbxNotFoundError`       | `$SBX` / PATH did not resolve to a runnable binary.                                    |
| `SbxNotLoggedInError`    | `sbx` ran and asked for a Docker sign-in.                                              |
| `SandboxMissingError`    | The named instance does not exist. Distinct from a generic failure: `nuke` must abort. |
| `SandboxExistsError`     | `create` refused a taken name.                                                         |
| `SecretAbsentError`      | A listing was read and the named secret is genuinely absent.                           |
| `VolumeUnsupportedError` | A volume operation is not available in this mode.                                      |
| `EgressBlockedError`     | The sandbox proxy answered 403 for a request.                                          |
| `SbxTimeoutError`        | The bounded command expired. Distinct from a non-zero exit.                            |
| `SbxCommandError`        | The process never ran (`exitCode: null`) or exited non-zero.                           |
| `SbxOutputError`         | `sbx` printed something the seam could not parse.                                      |

`SecretAbsentError` is defined here but not thrown by `secrets`: the seam
returns the listing, and the CLI decides absence. That keeps the
"could-not-tell" case (a failed listing) in the failure channel instead of
collapsing it into an empty array — the bug the seam's failure channel exists
to prevent.

## What stays outside the seam

The seam returns data. The CLI owns everything that is policy or presentation:

- usage text and the verb list;
- output formatting and wording;
- the pairing-URL rewrite (`t3 pair` prints the outbound interface address; the
  host browser needs `http://localhost:<published-port>/pair#token=…`);
- policy printing (`policy/allow.txt`);
- confirmation prompts and `--yes` on a non-TTY;
- exit codes (`0` success, `1` failure, `2` usage);
- the decision that a missing `github` secret is a warning rather than a
  failure.

## `sbx` quirks the seam hides

- The invocation is `sbx version`, not `sbx --version`: `--version` (added in
  0.51.0) prints the client version only, and the probe wants the daemon and
  build detail too.
- `--no-input` (0.51.0) is a global flag and goes before the verb. The seam
  puts it on every command except `attach` and an interactive `exec -it`, so a
  prompt fails fast with the command to run instead of waiting on stdin until
  the command's timeout — `create`'s is an hour.
- `sbx exec` on a stopped sandbox starts it, which runs the `lifecycle@1` hook
  and starts `t3 serve`. `nuke` must kill it before wiping.
- `sbx rm --force` keeps volume storage; retention is conditional in `sbx`'s
  own words. `rebuild` relies on it; `nuke` is adversarial to it.
- `sbx volume` is cloud-only; `sbx reset` is the only local purge and it resets
  the whole installation.
- A blocked egress request is an HTTP 403 from the proxy, not a connection
  error. The body names the host.
- `sbx` has no structured error codes, so "missing sandbox", "not logged in",
  and "name exists" are text predicates. They are the most fragile part of the
  seam and the first thing to replace if `sbx` grows machine-readable output.

## Finding: the live adapter exposed a dependency pin gap

The first live run failed before it reached `sbx`:

```
Cannot find module 'effect/dist/process/CommandLine.js'
imported from @effect/platform-node-shared/dist/NodeChildProcessSpawner.js
```

`@effect/platform-node@4.0.5` declared
`@effect/platform-node-shared: ^4.0.5`, so npm installed `4.1.1`. That version
imported `effect/dist/process/CommandLine.js`, which only exists in
`effect@4.1.x`; the root `overrides` pinned `effect` to `4.0.5`, so the tree was
inconsistent. Nothing in the repo had imported `NodeServices` before, so the
existing tests never exercised it.

The root `overrides` pinned `"@effect/platform-node-shared": "4.0.5"` to keep
the pair in step, and the live adapter ran end to end against a fake `sbx` on
`PATH`. This was a durable fix, not a prototype detail: the production seam
uses the same `NodeServices.layer`. The pin was recorded in
[the v2 workspace ADR](../adr/0002-v2-workspace-layout-and-distribution.md) and
asserted by `scripts/layout.test.ts`.

The pin is history now: `effect` 4.1.2 ships a matching
`@effect/platform-node-shared`, so #75 deleted the override and its assertion.
The finding stands — nothing loaded `NodeServices` until the live adapter did,
so only a real run could have caught it.

## Open questions, and how they were answered

These were the questions the prototype existed to provoke. All were approved
as-is, with "if friction surfaces, refactor" as the standing caveat; they are
kept here because the answers are what the production module encodes.

1. **Is `Adapter` the right seam?** It keeps the service pure and makes the
   fake trivial, but it puts `capabilities` in the adapter. Should the probe be
   a service method that the fake scripts instead?
2. **`exec` + `execChecked`, or one method?** The pair mirrors the two callers:
   probes want the exit code as data, verbs want a failure. One method would
   force one of them to unwrap an error.
3. **Is `probeEgress` in the seam?** It is a sandbox-runtime fact, not an `sbx`
   verb. It could live in the smoke suite instead, with the seam only providing
   `exec`.
4. **`list` parsing.** The host run confirmed the columns
   `SANDBOX AGENT STATUS PORTS WORKSPACE CREATED`, and that `STATUS`, `PORTS`,
   and `WORKSPACE` all contain spaces. The parser sliced by the header's column
   offsets. Is that table stable across `sbx` versions, and is there a `--json`
   or `--format` flag that would make the parser unnecessary? **Answered by
   `sbx` 0.51.0:** `sbx ls --json` exists, and the offset slicing is gone. The
   same flag is available on `sbx ports`, which still parses its table.
5. **`SecretAbsentError` placement.** The seam defines it; the CLI throws it.
   Is that the right split, or should `secrets` take the name and fail?
6. **`PortMapping`.** The prototype hardcodes `127.0.0.1` in `create`. Should
   the mapping carry the bind address, or is loopback the only supported one?
7. **TTY.** The live adapter maps `tty` to `stdin`/`stdout`/`stderr: "inherit"`.
   Is that enough for `sbx exec -it`, or does the attach path need `sbx attach`
   as a fallback?
8. **`SbxNotFoundError` on Windows.** The live adapter maps a
   `PlatformError` with reason `NotFound` to "not installed". Is that reliable
   for `sbx.exe`, or does the PATHEXT resolver from t3code's `shell.ts` need to
   be part of the seam?
9. **Fake capabilities.** The fake's `capabilities` is static. Should a test be
   able to script a cloud/local switch and a `rm --help` that changes between
   calls?
10. **`make` export.** The fake builds the service from `make(adapter)`. Is
    that the right test surface, or should the fake provide a full `Sbx`
    service so the service logic is not shared with the test?
