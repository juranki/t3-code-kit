## Agent skills

### Issue tracker

Issues live as GitHub issues in `juranki/t3-code-kit`, managed with the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical triage roles use their default label strings (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.

### Workspace

Node 26.13.0, npm workspaces, Vite+ 1.4.0, Effect 4.1.2. `npm ci` installs the
workspace; `npm run check` is the fast gate (format, lint, typecheck, tests) and
`npm run smoke` is the host acceptance. There is no `bin/` launcher: `npm run
<verb>` is the interface, `npm run help` prints the verbs, and the old `sh` and
PowerShell twins are gone (#42). The CLI is `apps/cli`; the typed `sbx` seam is
`packages/sbx`; process and git services are `packages/host`; shared kit data is
`packages/kit`. See `docs/operations/v2-dev-loop.md` and
`docs/adr/0002-v2-workspace-layout-and-distribution.md`.

### Imports and single tests

`@t3ck/<package>/<Module>` is `packages/<package>/src/<Module>.ts` (`apps/cli`
for `@t3ck/cli`), declared in that package's `exports`. `npx vp test run <path>`
runs one test file in about a second; `npm run check` is the whole gate (about
50 s) and the only run that counts as green.

### Where a change lands

| Change        | Files                                                                                                                                                                  |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Add a verb    | `apps/cli/src/usage.ts` (verb table), `apps/cli/src/main.ts` (dispatch), `apps/cli/src/verbs.ts` + `verbs.test.ts`, `package.json`, `scripts/characterization/golden/` |
| Change egress | `kit/t3-code.yaml` (network policy), `policy/allow.txt` (runtime), `policy/install.txt` (build), `packages/kit/src/Policy.ts`, `scripts/smoke.ts` (mirror check)       |
| Bump a pin    | `kit/t3-code.yaml` (descriptor default), `kit/t3-code.dockerfile` (`ARG`), `scripts/layout.test.ts` (asserts they match)                                               |

### Durability

`rebuild` recreates a sandbox from a freshly built image and keeps its durable
state. `nuke` wipes the four volumes' contents from inside the sandbox, then
removes the instance; the volume objects stay allocated and empty. See
`docs/adr/0003-durability-model.md`.

### Vendored Repositories

This project vendors external repositories under `repos/`.

- Use vendored repositories as read-only reference material when working with related libraries.
- Prefer examples and patterns from the vendored source code over generated guesses or web search results.
- Do not edit files under `repos/` unless explicitly asked.
- Do not import from `repos/` - application code should continue importing from normal package dependencies.

A root `.ignore` excludes `repos/` from `rg` and `fd`, and `.gitattributes`
marks it `linguist-vendored`, so a shell search returns project code only. That
is about accidental noise, not about discouraging reference reading: open a
vendored file deliberately whenever that is what you need.

When writing Effect code, inspect `repos/effect/` for examples of idiomatic usage, tests, module structure, and API design. Treat it as the source of truth for Effect patterns. Read `repos/effect/LLMS.md` before writing any Effect code, then use the project-local notes in `agent-patterns/`.

`repos/effect` is a git subtree pinned to the `effect@4.1.2` tag. Its update command and the reason it is vendored are in `agent-patterns/README.md`.

### Lint rules

The conventions in this file and `docs/design/sbx-seam.md` are enforced by the
rules in `lint/`, registered in `vite.config.ts`. See `lint/README.md` for the
rule list and what each one catches.

### Coding standards

[`CODING_STANDARDS.md`](./CODING_STANDARDS.md) is the coding standard: the gate
is the standard, and a lint warning is a defect. `npm run lint` must exit 0 with
zero warnings, so the script runs `vp lint --deny-warnings`. Do not suppress a
warning or downgrade a rule to get there; fix the code, or stop and report the
warning you cannot fix.
