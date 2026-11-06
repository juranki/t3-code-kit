# Codex is a second baked agent, authenticated by an API key through the proxy

T3 Code can drive Codex as a built-in provider. The kit bakes the `codex` CLI at
the `codexVersion` pin, the same way it bakes pi, and adds an optional `openai`
credential whose proxy-injected key is written into `~/.codex/auth.json` before
`t3 serve` starts. The sandbox never holds the real key.

## Why not let t3 install Codex

t3 can download a managed Codex runtime into `$T3CODE_HOME/tools`. That
directory is not a volume, so every `rebuild` throws the download away and the
first use downloads it again. The kit's rule is that the image is the
environment; a runtime install is the thing a rebuild is supposed to avoid.
Baking also makes `npm run smoke` able to assert the version.

## Why an API key, not ChatGPT OAuth

Codex's headline auth is a ChatGPT plan. That token would have to live in the
sandbox, where the agent can read it. The kit's containment model is that every
credential stays behind the proxy: the sandbox holds a sentinel, and the proxy
swaps it on egress. An OpenAI API key is the only Codex auth that fits that
model. The cost is real: ChatGPT-plan features and usage limits are not
available, and the README says so.

## Why `auth.json` and not `OPENAI_API_KEY`

`codex app-server` starts with environment API-key auth disabled
(`enable_codex_api_key_env: false`), so an exported `OPENAI_API_KEY` is ignored
by the path t3 uses. `codex login --with-api-key` writes the sentinel to
`~/.codex/auth.json`, which the app-server does read. `kit/serve.sh` re-runs it
on every start because `~/.codex` is not a volume.

## Considered Options

- **Let t3 manage the Codex install.** Rejected: a non-volume download that a
  `rebuild` discards, and a runtime install the pin cannot prove.
- **ChatGPT OAuth.** Rejected: the token would be readable inside the sandbox.
- **Export `OPENAI_API_KEY` only.** Rejected: the app-server does not read it.
- **A separate `openai-codex` service name.** Rejected for now: `openai` is the
  name a user expects from `sbx secret set openai`. The cost is that pointing pi
  at openai too collides on `(openai, runtime)`; the README makes that a stated
  limit rather than a silent failure.

## Consequences

A Codex version bump is a `codexVersion` change and a `rebuild`. The `openai`
service is shared with pi, so pi stays on a different provider. Codex's own
sandbox and approval rules still apply inside the microVM; the t3 thread's
permission mode is what selects full access. The skills CLI maps Codex's global
skills to the same `~/.agents/skills` directory as pi, so the baked skill set
serves both.
