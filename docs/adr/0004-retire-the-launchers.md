# Retire the shell and PowerShell launchers

The kit shipped two launchers — `bin/t3-code-kit` (POSIX `sh`) and
`bin/t3-code-kit.ps1` (PowerShell 7) — because telling a Windows user to
install bash was worse than maintaining a duplicate. They drifted anyway: the
`--help` exit code, the unknown-verb hint, the `down` failure message, and the
pairing-URL fallback all differed. The v2 port replaced both with one
TypeScript program in `apps/cli`, and #42 deleted the twins. This ADR records
that decision and the parity evidence behind it.

## The decision

**One implementation.** `apps/cli/src/bin.ts` is the only launcher. It runs on
Node 26 and is reached through `npm run <verb>`; `npm run` lists the verbs and
`npm run help` prints the usage. There is no `bin/` directory, no PowerShell
port, no installer, and no npm package.

**The argv/exit contract is the parity surface.** Output wording may change;
the sequence of `sbx` calls, the exit code, and the destructive confirmation
may not. `scripts/characterization.test.ts` pins that contract as golden
files, and `apps/cli/src/verbs.test.ts` pins the decisions a verb makes.

**The old launchers are not kept as a fallback.** Keeping them would mean two
programs answering to the same name and the same drift returning. The Windows
proof is the real smoke suite against `sbx.exe`, not a second launcher.

## Parity

The port was checked verb by verb, against the PowerShell launcher as the
reference (the one people actually used) and the `sh` launcher where it
differed deliberately.

| Surface                                                                                            | v2 behaviour                                                                                | Evidence                                                       |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `up`                                                                                               | secret check, existence check, create/start, port, identity, policy, readiness, pairing URL | characterization `up-*`; `verbs.test.ts` `up`                  |
| `url`                                                                                              | `t3 pair`, then the `serve.log` fallback, rewritten to the published loopback port          | characterization `url*`                                        |
| `logs`                                                                                             | `serve.log`, then the startup-hook log; line count from the second argument                 | characterization `logs*`                                       |
| `shell`                                                                                            | `exec -it … bash`, then `attach`                                                            | characterization `shell*`                                      |
| `refresh`                                                                                          | `stop`, then the `up` sequence                                                              | characterization `refresh*`                                    |
| `down`                                                                                             | `stop`; a failed stop is a failure with a sentence                                          | characterization `down*`                                       |
| `rebuild`                                                                                          | `rm --force`, then `up`; a missing instance is a successful rebuild                         | characterization `rebuild*`; ADR 0003                          |
| `nuke`                                                                                             | name confirmation, wipe, verify, retry once, abort before `rm` on a failed wipe             | `scripts/characterization.test.ts` destructive cases; ADR 0003 |
| `policy`                                                                                           | `policy/allow.txt`, comments stripped                                                       | characterization `policy`                                      |
| `doctor`                                                                                           | the seam's capability probe                                                                 | `verbs.test.ts` `doctor`                                       |
| `help` / no verb / unknown verb                                                                    | usage, exit 0 / exit 2 / exit 1                                                             | characterization `help*`, `no-args`, `unknown-verb`            |
| `T3CK_NAME`, `T3CK_PORT`, `T3CK_READY_TIMEOUT`, `T3CK_AGENT_NAME_PREFIX`, `SBX_KIT_BUILDER`, `SBX` | resolved once in `apps/cli/src/config.ts` and the live adapter                              | `config.test.ts`; `verbs.test.ts`                              |
| destructive confirmation                                                                           | TTY name prompt; `--yes` required on a non-TTY; exit 2 before touching anything             | `verbs.test.ts` `nuke`                                         |

The two places v2 deliberately follows `sh` rather than the PowerShell
reference are `--help` (usage and exit 0, not a parameter-binding error) and
the unknown-verb exit code; the hint itself now points at `npm run help`. Both
are recorded in the goldens.

## What this changes for the host

- **Node 26.13.0 and Vite+ 1.4.0 replace PowerShell 7.** The Vite+ installer
  provides Node on Windows; `npm ci` installs the workspace. The old
  "PowerShell 7 is the one Windows prerequisite" line is gone.
- **`npm run` replaces the `t3-code-kit` command.** Hints in errors and docs
  now say `npm run logs -- <name>` rather than `t3-code-kit logs <name>`.
- **The repo can go public.** The `sh`/`ps1` retirement was the gate in #55;
  CI on GitHub Actions remains a separate, later effort.

## Remaining backlog

- **#16 and #17** are answered by ADR 0003 and implemented by #39: `rebuild`
  keeps durable state, and `nuke` wipes volume contents before removing the
  instance. The old wording and the missing smoke assertion are gone.
- **#24** (pi under a non-TTY `sbx exec`) is still open. The smoke suite skips
  the agent round-trip by default, bounds it with `SMOKE_AGENT_TIMEOUT`, and
  kills it inside the sandbox; the underlying pi behaviour is upstream.
- **#48** (`Agent for ` prefix accumulation) is still open. The v2 identity
  path is the same read-host-then-prefix rule, so the fix belongs in
  `apps/cli/src/verbs.ts`; the issue's `bin/test`/launcher references are
  updated to the v2 files.

## Verification

Recorded in
[`docs/operations/v2-final-acceptance.md`](../operations/v2-final-acceptance.md):
the Linux sandbox runs `npm run check` (143 passed), and the Windows host runs
the same gate (103 passed, 40 skipped) plus the real-`sbx` smoke (42 passed, 0
failed, 1 skipped, sandbox nuked). The Windows run is the one that proves the
loop without PowerShell as a launcher.
