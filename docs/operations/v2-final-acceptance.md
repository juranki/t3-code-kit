# v2 final acceptance

The acceptance record for [Final v2 acceptance and remove
PowerShell](https://github.com/juranki/t3-code-kit/issues/42). The v2 CLI is the
only launcher; `bin/` is gone and there is no PowerShell port.

## What the Linux sandbox proves

Run on 2026-11-02 on branch `t3/implement-ticket-42-map-29`, Node 22.23.4 (the
sandbox's Node; the workspace pins 26.13.0 for the host and image), no `sbx`:

```console
$ npm run check
Test Files  10 passed (10)
     Tests  143 passed (143)

$ npm run -s help
usage: npm run <verb> [-- sandbox-name]
  up       create or start the sandbox, publish the port, print the pairing URL
  ...
  doctor   print the sbx capabilities this host reports

$ npm run -s policy
egress allowed at runtime (everything else denied):
  api.anthropic.com
  ...

$ ls bin
ls: cannot access 'bin': No such file or directory
```

`npm run check` covers the fast gate: `fmt:check`, `lint`, `tsc --noEmit`, and
the unit/characterization suite. The suite includes the 35-case CLI
characterization, the 5 destructive `nuke` cases, the seam and verb tests, and
the layout invariants. The old `sh`/`ps1` characterization (80 tests) is gone
with the launchers.

The Linux sandbox cannot run the real-`sbx` smoke: there is no `sbx` binary and
no sandbox runtime here. That is the one host-only step below.

## What the Windows host proves

Run on 2026-11-02 on Windows 11 with `sbx` v0.50.1, in `~/src/t3-code-kit`
on branch `t3/implement-ticket-42-map-29`:

```console
$ npm run check
Test Files  9 passed | 1 skipped (10)
     Tests  103 passed | 40 skipped (143)

$ npm run smoke -- t3ck-smoke-42
...
  42 passed, 0 failed, 1 skipped
  sandbox was nuked by the durability checks
```

The `npm ci` install on this host was already proven in #32/#50; this run
repeats the fast gate and the smoke on the branch. The only skip is the pi
round-trip (`SMOKE_AGENT=1` to run it). The durability
checks passed: `rebuild` kept the marker in `.t3/userdata` and `workspace`;
`nuke` refused without `--yes` on a non-TTY and removed nothing; it then wiped
the volumes, left no marker in any of the four, and left `workspace` empty
after `nuke` + `up`; the same four volume objects reattached; and `nuke` on a
missing instance exited non-zero.

### How to reproduce

Run this from a **fresh clone** of the branch, in a new directory, with no
`bin/` from an older checkout. The point is to prove the v2 loop works without
PowerShell as a launcher.

1. **Install Vite+ (it provides Node 26.13.0).**

   ```powershell
   irm https://vite.plus/ps1 | iex
   node --version   # v26.13.0
   vp --version     # 1.4.0
   ```

2. **Clone and install.**

   ```powershell
   git clone https://github.com/juranki/t3-code-kit
   cd t3-code-kit
   git checkout t3/implement-ticket-42-map-29
   npm ci
   ```

   Expect 100 packages and 0 vulnerabilities. The `@tsc-rs/typescript`
   postinstall stays unapproved.

3. **Run the fast gate.**

   ```powershell
   npm run check
   ```

   Expect 10 files and 103 passed, 40 skipped (the CLI characterization is
   skipped on Windows because its fake `sbx` is a PowerShell shim and the seam
   spawns `$SBX` directly).

4. **Run the smoke against a scratch sandbox.**

   ```powershell
   $env:SMOKE_DOWN = 1
   npm run smoke -- t3ck-smoke-42
   ```

   Expect the same shape as the #39/#40 runs: every check `PASS`, the pi
   round-trip `SKIP` (it is off by default), and a non-zero exit only on a real
   failure. The durability checks write a marker, `rebuild` and read it back,
   then `nuke` and `up` the same name and assert the old contents are gone and
   the same volume objects reattach.

5. **Exercise the verbs by hand.**

   ```powershell
   npm run up -- t3ck-accept
   npm run url -- t3ck-accept
   npm run logs -- t3ck-accept
   npm run doctor
   npm run nuke -- t3ck-accept --yes
   ```

   `nuke` without `--yes` must prompt for the name on a TTY and refuse on a
   non-TTY. `npm run help` must print the usage. There must be no `bin/`
   directory and no `*.ps1` launcher in the tree.

6. **Record the result** in a comment on #42 (and, if you want a durable log,
   `docs/operations/v2-final-acceptance-<date>.log`). The 2026-11-02 run is
   recorded above.

## Parity matrix

The verb-by-verb parity table, the environment variables, the destructive
confirmation, and the error paths are in
[ADR 0004](../adr/0004-retire-the-launchers.md#parity). The short version:

| Surface                                                                                                                    | Where it is pinned                                                                                          |
| -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| argv sequence, exit code, warnings for every verb                                                                          | `scripts/characterization.test.ts` + `scripts/characterization/golden/`                                     |
| destructive `nuke` confirmation and wipe/verify/abort sequence                                                             | `scripts/characterization.test.ts` destructive cases; `apps/cli/src/verbs.test.ts`                          |
| environment variables (`T3CK_NAME`, `T3CK_PORT`, `T3CK_READY_TIMEOUT`, `T3CK_AGENT_NAME_PREFIX`, `SBX_KIT_BUILDER`, `SBX`) | `apps/cli/src/config.test.ts`; `packages/sbx/src/live.ts`                                                   |
| error paths (missing secret, failed create/run/stop/rm, missing sandbox, failed wipe)                                      | `apps/cli/src/verbs.test.ts`; characterization `up-*`, `down-*`, `rebuild-*`                                |
| git identity: the host's name decorated exactly once, the email untouched                                                  | `apps/cli/src/identity.test.ts`; `apps/cli/src/verbs.test.ts`; smoke; `up-host-name-already-prefixed-twice` |

## Remaining backlog

- **#16 / #17** — answered by ADR 0003 and implemented by #39; the v2 smoke
  asserts the durability model.
- **#24** — pi under a non-TTY `sbx exec` is still open upstream. The smoke
  skips the agent round-trip by default and bounds it when enabled.
- **#55** — the pre-publication checklist is unblocked by the launcher
  retirement; CI on GitHub Actions is a separate, later effort.

## Addendum (#48): the identity, asserted exactly

Run on 2026-11-02 on Windows 11 with `sbx` v0.50.1, in `~/src/t3-code-kit`,
on branch `t3/implement-ticket-48`:

```console
$ npm run check
Test Files  10 passed | 1 skipped (11)
     Tests  121 passed | 41 skipped (162)

$ npm run smoke
...
== egress and credentials
  PASS  git ls-remote https://github.com/juranki/t3-code-kit (network + github credential)
  PASS  git identity name is 'Agent for Juhani Ränkimies' - what 'up' applied
  PASS  git identity email is 'juhani@example.com'
...
  42 passed, 0 failed, 1 skipped
  sandbox was nuked by the durability checks
```

The two identity lines are the #48 assertion. The smoke reads the host's
`git config --get user.name`/`user.email`, applies the CLI's own rule to them,
and compares the sandbox's `git config --global` values to the result exactly.
This host's config was already decorated — the bug's precondition — and the
sandbox got one prefix, not two. A repeated prefix now fails the smoke instead
of passing as "configured", which is what the shape check it replaced did.

## Addendum (#45): the preview browser

Run on 2026-11-02 on Windows 11 with `sbx` v0.50.1, in `~/src/t3-code-kit`,
on branch `t3/bake-browser-deps-45`:

```console
$ npm run check
Test Files  10 passed | 1 skipped (11)
     Tests  126 passed | 41 skipped (167)

$ npm run smoke
...
== preview browser inside the sandbox
  PASS  the preview browser is baked in at /home/agent/.t3/tools/chrome-headless-shell/linux64/156.0.8078.70/chrome-headless-shell
  PASS  ldd reports no missing libraries
  PASS  chrome-headless-shell 156.0.8078.70 starts
  PASS  fc-match resolves sans-serif to /usr/share/fonts/truetype/liberation/LiberationMono-Regular.ttf
...
  46 passed, 0 failed, 1 skipped
  sandbox was nuked by the durability checks
```

Those four lines are the #45 assertion, and they are what was missing before:
the image builds the browser layer, the binary lands at the path t3 looks in
(`$T3CODE_HOME/tools/chrome-headless-shell/linux64/<version>/`, with the
version compared against the Dockerfile's `CHROME_VERSION` pin), the loader
resolves every library, the binary starts, and `fc-match` resolves to a file
rather than to the pattern it was given.

`ldd` alone is not the proof it looks like: run against a missing file it also
prints `0` "not found", which is why the ticket's original acceptance passed
vacuously. The path check and the `--version` comparison are what make it real.

The one thing the suite cannot assert is the render itself — a PNG's size does
not prove glyphs — so `html_preview` of a page with text stays a human check.

Two lines were added to that section after this run — a proportional-glyph
measurement (8 `I` against 8 `W`: ~3.4 for a real font, exactly 1 for tofu
boxes) and an HTTPS origin — so the next host run covers six browser checks,
not four. The glyph measurement was taken here, in a sandbox from the same
image: `glyphs=88.90625,302.03125`.
