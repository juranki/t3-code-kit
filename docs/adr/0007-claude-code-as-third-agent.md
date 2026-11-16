# Claude Code is a third baked agent, authenticated through the proxy

T3 Code can drive Claude Code through its Claude provider. The kit bakes the
`claude` CLI at the `claudeCodeVersion` pin, and declares an optional
`anthropic` credential with both presentations `credential@1` offers: a console
API key and Claude subscription OAuth. sbx surfaces which one the host bound as
`SBX_CRED_ANTHROPIC_MODE`, and `kit/serve.sh` writes `~/.claude/settings.json`
from it. The sandbox only ever holds sentinels; the proxy injects the real
credential. This is [ADR 0006](0006-codex-as-second-agent.md)'s shape, applied
to a second vendor.

## Why pin over the base image's `claude`

The base image (`sbx-templates:claude-code-docker`) already ships a `claude` in
`~/.local/bin`, at whatever version the template was built with. That version
is not the kit's choice, and smoke cannot assert it. The kit installs
`@anthropic-ai/claude-code` into the npm prefix, which is ahead of
`~/.local/bin` on `PATH`; the Dockerfile fails if `command -v claude` resolves
anywhere else. The auto-updater is off (`DISABLE_AUTOUPDATER`), so the pin is
also what keeps running.

## Why the API key is not `ANTHROPIC_API_KEY`

Claude Code reads `ANTHROPIC_API_KEY` from its environment and prefers it over a
subscription login. A proxy-managed sentinel under that name would therefore
shadow a bound subscription. The kit names the variable `CLAUDE_PROXY_API_KEY`,
which Claude Code ignores, and in API-key mode only, `serve.sh` writes an
`apiKeyHelper` that prints the sentinel. The proxy swaps it at
`api.anthropic.com` in `x-api-key`. In OAuth mode there is no helper: a helper
would turn the session into an API-key session.

## Why `credentialFile` here, when Codex did not use it

Codex's ChatGPT auth needs `id_token` and `account_id`, which the
credential-file placeholders do not expose. Claude Code's
`~/.claude/.credentials.json` needs only `claudeAiOauth.{accessToken,
refreshToken, expiresAt, scopes}`, all of which are placeholders. sbx renders it
with the sentinels, and `serve.sh` only checks that it is there.

## Considered Options

- **Let t3 or the template decide the version.** Rejected: an unpinned agent
  that a rebuild can silently move.
- **`ANTHROPIC_API_KEY` with `proxyManaged`.** Rejected: shadows a subscription.
- **API key only.** Rejected: a Claude subscription is how most users run
  Claude Code, and the proxy's OAuth presentation keeps that token out of the
  sandbox.
- **`--agent claude-code` skills in the shared directory.** Not possible:
  Claude Code reads only `~/.claude/skills`, so the build writes a second copy
  and asserts both counts.

## Consequences

A Claude Code bump is a `claudeCodeVersion` change and a `rebuild`. The
`anthropic` service is shared with pi, so pi stays on a different provider. The
binding must match the credential type: `api.anthropic.com` for an API key;
`platform.claude.com` and `api.anthropic.com` for OAuth. The sandbox's
`AGENTS.md` context is not read by Claude Code, which reads `CLAUDE.md`; the
sandbox rules reach it only through a repo's own files until that is wired.
