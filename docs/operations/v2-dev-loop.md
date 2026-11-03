# The v2 dev loop

How to install, check, test and smoke the v2 workspace on a host. The rationale
is in [ADR 0002](../adr/0002-v2-workspace-layout-and-distribution.md); the
commands are here.

Everything below was run on the Windows host on 2026-11-01 against `d8ab695`
([captured run](./windows-host-loop-2026-11-01.log)). The `sh`/PowerShell
launchers were retired in #42; the commands and counts here are for the v2 CLI
only. The final acceptance run is in
[`v2-final-acceptance.md`](./v2-final-acceptance.md).

## Versions

| Tool         | Host               | Image   | Where it comes from                          |
| ------------ | ------------------ | ------- | -------------------------------------------- |
| Node         | 26.13.0            | 26.13.0 | `%LOCALAPPDATA%\vite-plus\bin\node.exe`      |
| npm          | 11.20.0            | 11.20.0 | the same Vite+ install                       |
| Vite+ (`vp`) | 1.4.0              | 1.4.0   | the same Vite+ install                       |
| `sbx`        | 0.50.1 (`ddb0268`) | n/a     | `%LOCALAPPDATA%\DockerSandboxes\bin\sbx.exe` |
| git          | 2.34.1.windows.1   | n/a     | `C:\Program Files\Git\cmd\git.exe`           |
| fd           | n/a                | 10.5.0  | `/usr/local/bin/fd` in the image             |

On Windows the Vite+ global install **is** the Node install: `node`, `npm`, `vp`
and `pnpm` all resolve into `%LOCALAPPDATA%\vite-plus\bin`. There is no second
Node to keep in step, and `vp` is not optional — it is what provides Node.

`pnpm` is on that `PATH` too (12.16.1) and the workspace never uses it. ADR 0002
chose npm workspaces; `pnpm install` would write a second lockfile and a second
`node_modules` shape. Leave it alone.

`sbx` has no `--version` flag (`error: unknown flag: --version`, exit 1). Use
`sbx version`.

## Install

```powershell
npm ci
```

100 packages, ~30 s cold, 0 vulnerabilities, from the committed
`package-lock.json`. It warns that `@tsc-rs/typescript` has an unapproved
install script. Leave it unapproved: `tsc --noEmit` passes without it on both
hosts. The postinstall only rewrites the POSIX `tsc` bin as a sh/JS polyglot to
skip Node's ~22 ms startup, and it deliberately stays a JS launcher on Windows.
Approve it only if a host reports a missing binary:

```powershell
npm install-scripts approve @tsc-rs/typescript
```

The lockfile resolves both ways from either host — `npm ci` on Windows,
`npm ci --os=linux --cpu=x64` on Windows, and `npm ci --os=win32 --cpu=x64` on
Linux all succeed with no `ERESOLVE`. The win32 tree is 100 packages, the linux
one 95: the platform `optionalDependency` sets differ. The `typescript` and
`vite` overrides in the root manifest are what make that true; do not replace
them with `--legacy-peer-deps`.

## The fast gate

```powershell
npm run check
```

`fmt:check` → `lint` → `typecheck` → `test`, ~50 s, no sandbox and no network.
Expected counts differ by platform because the CLI characterization is skipped
on Windows, not because a test is missing:

| Host          | Files | Tests                                                                                                                                                   |
| ------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Linux / macOS | 10    | 143 passed (10 layout + 35 CLI characterization + 5 destructive + 17 seam + 39 CLI + 4 pairing + 1 policy + 15 config + 6 support + 4 runner + 7 smoke) |
| Windows       | 10    | 103 passed, 40 skipped (the CLI characterization)                                                                                                       |

The CLI characterization is skipped on Windows because its fake `sbx` is a
PowerShell shim and the seam spawns `$SBX` directly. The production binary is a
real `sbx.exe`; the Windows proof is `npm run smoke` against a scratch sandbox.

Individual steps: `npm run fmt`, `npm run fmt:check`, `npm run lint`,
`npm run typecheck`, `npm test`.

## What needs a sandbox

| Check                  | Command                                         | Needs                                         |
| ---------------------- | ----------------------------------------------- | --------------------------------------------- |
| layout invariants      | `npm test` (`scripts/layout.test.ts`)           | nothing                                       |
| CLI characterization   | `npm test` (`scripts/characterization.test.ts`) | nothing — fake `sbx`/`git`/`curl`/`sleep`     |
| seam and verb tests    | `npm test` (`packages/sbx`, `apps/cli`)         | nothing — fake `Sbx`/`ProcessRunner` layers   |
| smoke                  | `npm run smoke`                                 | real `sbx`, a scratch sandbox, stored secrets |
| real-`sbx` integration | manual: `npm run up` on the host                | real `sbx`, a scratch sandbox                 |

The CLI characterization is the parity guardrail: 35 golden cases over
`apps/cli/src/bin.ts`, each recording the argv sequence, exit code and warnings,
plus 5 destructive `nuke` cases asserted directly. It needs no sandbox because
every external command is an executable fake on `PATH`. On Windows the `sbx`
fake is a PowerShell shim and the rest are `.cmd`: the identity call passes a
base64 blob as a single argument, and `cmd.exe` re-parses the `|` and `$` inside
it before the fake ever runs, which is why the suite is skipped there.

## How `sbx` is invoked

`sbx` is a real executable — one `sbx.exe` on `PATH` — so `spawn("sbx", argv)`
with no `shell: true` is enough, and the seam needs no escaped-command-line
branch. Verified with `spawnSync("sbx", ["version"])`, which ran the binary and
returned `v0.50.1 ddb0268…` with status 0. A `.cmd` or `.bat` shim here would
mean the seam had to quote the whole command line itself.

## Smoke

```powershell
$env:SMOKE_DOWN = 1     # on failure, stop the sandbox instead of leaving it running
npm run smoke -- t3ck-smoke-32
```

The suite prints `PASS` / `FAIL` / `SKIP` per check and exits non-zero on any
failure. It prints the `sbx` capabilities first, so a failure is attributable to
the runtime it ran against. The first run after a `kit/` change rebuilds the
image and takes 10–25 minutes; later runs are 3–6.

A successful run ends with the sandbox nuked by the durability checks. A failed
one leaves it running so you can look at it, unless `SMOKE_DOWN=1`, which stops
it — and stopping does not remove it, so the volume objects stay allocated
(ADR 0003). `sbx rm <name>` when you are done.

| Variable              | Default | What it does                                       |
| --------------------- | ------- | -------------------------------------------------- |
| `SMOKE_AGENT`         | off     | run the pi round-trip; it spends real model tokens |
| `SMOKE_AGENT_TIMEOUT` | 120     | seconds before a wedged pi fails the check         |
| `SMOKE_DOWN`          | off     | stop the sandbox when a check fails                |
| `SMOKE_NUKE_TIMEOUT`  | 2400    | seconds bounding each `nuke`                       |

## The CLI

`npm run <verb>` reaches `apps/cli/src/bin.ts`. Every verb is live: `up`, `url`,
`logs`, `shell`, `refresh`, `down`, `rebuild`, `nuke`, `policy`, `doctor`, and
`help`. They run through the `Sbx` seam in `packages/sbx` (`ProcessRunner` →
`sbx`), and the CLI characterization suite pins their argv/exit contract.

`rebuild` and `nuke` follow ADR 0003: `rebuild` keeps durable state, `nuke`
wipes the four volumes' contents and then removes the instance. `npm run smoke`
is the orchestrator in `scripts/smoke.ts`; its durability assertions exercise
both verbs.

`npm run -s shell -- <name>` in an interactive terminal exercises the real
`shell` verb, including the `sbx attach` fallback.

## The image

`kit/t3-code.dockerfile` bakes the same Node 26.13.0 plus Vite+ 1.4.0 and
fd 10.5.0. `scripts/layout.test.ts` asserts those pins match the descriptor, so
a bump that touches one and not the other fails `npm test`.
