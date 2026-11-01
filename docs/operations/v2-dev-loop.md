# The v2 dev loop

How to install, check, test and smoke the v2 workspace on a host. The rationale
is in [ADR 0002](../adr/0002-v2-workspace-layout-and-distribution.md); the
commands are here.

Everything below was run on the Windows host on 2026-11-01 against `d8ab695`
([captured run](./windows-host-loop-2026-11-01.log)).

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

`fmt:check` → `lint` → `typecheck` → `test`, ~45 s, no sandbox and no network.
Expected counts differ by platform because the `sh` launcher is skipped on
Windows, not because a test is missing:

| Host          | Files | Tests                              |
| ------------- | ----- | ---------------------------------- |
| Linux / macOS | 2     | 89 (9 layout + 40 `sh` + 40 `ps1`) |
| Windows       | 2     | 49 (9 layout + 40 `ps1`)           |

A Linux run that reports 49 has lost `pwsh` from `PATH` and the characterization
suite quietly dropped its reference launcher. A Windows run that reports more
than 49 is running launchers it should not.

Individual steps: `npm run fmt`, `npm run fmt:check`, `npm run lint`,
`npm run typecheck`, `npm test`.

## What needs a sandbox

| Check                  | Command                                         | Needs                                         |
| ---------------------- | ----------------------------------------------- | --------------------------------------------- |
| layout invariants      | `npm test` (`scripts/layout.test.ts`)           | nothing                                       |
| characterization       | `npm test` (`scripts/characterization.test.ts`) | nothing — fake `sbx`/`git`/`curl`/`sleep`     |
| smoke                  | `bin/smoke` · `.\bin\smoke.ps1`                 | real `sbx`, a scratch sandbox, stored secrets |
| real-`sbx` integration | —                                               | not ported yet (#35, #37, #39, #40)           |

The characterization suite is the parity guardrail: 40 golden cases over both
launchers, `ps1` as the reference, each recording the argv sequence, exit code
and warnings. It needs no sandbox because every external command is an
executable fake on `PATH`. On Windows the `sbx` fake is a PowerShell shim and
the rest are `.cmd`: the identity call passes a base64 blob as a single
argument, and `cmd.exe` re-parses the `|` and `$` inside it before the fake ever
runs.

## How `sbx` is invoked

`sbx` is a real executable — one `sbx.exe` on `PATH` — so `spawn("sbx", argv)`
with no `shell: true` is enough, and the seam needs no escaped-command-line
branch. Verified with `spawnSync("sbx", ["version"])`, which ran the binary and
returned `v0.50.1 ddb0268…` with status 0. A `.cmd` or `.bat` shim here would
mean the seam had to quote the whole command line itself.

## Smoke

```powershell
$env:SMOKE_DOWN = 1     # stop the sandbox afterwards; otherwise it is left running
.\bin\smoke.ps1 t3ck-smoke-32
```

33 passed, 0 failed, 1 skipped on 2026-11-01. The skip is the pi round-trip
(`SMOKE_AGENT=1` to run it): it spends real tokens, and pi hangs under a non-TTY
`sbx exec` (#24). The first run after a `kit/` change rebuilds the image and
takes 10–25 minutes; later runs are 3–6.

`SMOKE_DOWN=1` stops the sandbox but does not remove it — the volume objects
stay allocated (ADR 0003). `sbx rm <name>` when you are done with it.

## The v2 CLI is still a stub

`npm run <verb>` reaches `apps/cli/src/bin.ts`, which prints
`t3-code-kit: the v2 CLI is not implemented yet (v2 map #29)` and exits 2 until
#37 and #39 land. `npm run -s shell -- <name>` in an interactive terminal
therefore proves only that `npm run -s` passes the terminal through and keeps
the exit code; the attach assertion waits for the `shell` verb.

`npm run smoke` does not exist yet either — the smoke suite is `bin/smoke*`
until #40 ports it.

## The image

`kit/t3-code.dockerfile` bakes the same Node 26.13.0 plus Vite+ 1.4.0 and
fd 10.5.0. `scripts/layout.test.ts` asserts those pins match the descriptor, so
a bump that touches one and not the other fails `npm test`.
