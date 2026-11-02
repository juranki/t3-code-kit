## Agent skills

### Issue tracker

Issues live as GitHub issues in `juranki/t3-code-kit`, managed with the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical triage roles use their default label strings (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.

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

When writing Effect code, inspect `repos/effect/` for examples of idiomatic usage, tests, module structure, and API design. Treat it as the source of truth for Effect patterns. Read `repos/effect/LLMS.md` before writing any Effect code, then use the project-local notes in `agent-patterns/`.

`repos/effect` is a git subtree pinned to the `effect@4.0.5` tag. Its update command and the reason it is vendored are in `agent-patterns/README.md`.
