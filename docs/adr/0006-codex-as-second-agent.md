# Codex is a second baked agent, authenticated through the proxy

T3 Code can drive Codex as a built-in provider. The kit bakes the `codex` CLI at
the `codexVersion` pin, the same way it bakes pi, and declares an optional
`openai` credential with **both** presentations the `credential@1` capability
offers: an API key and ChatGPT OAuth. sbx surfaces which one the host bound as
`SBX_CRED_OPENAI_MODE`, and `kit/serve.sh` seeds `~/.codex/config.toml` and
`auth.json` from it. The sandbox only ever holds sentinels; the proxy injects
the real credential.

## Why not let t3 install Codex

t3 can download a managed Codex runtime into `$T3CODE_HOME/tools`. That
directory is not a volume, so every `rebuild` throws the download away and the
first use downloads it again. The kit's rule is that the image is the
environment; a runtime install is the thing a rebuild is supposed to avoid.
Baking also makes `npm run smoke` able to assert the version.

## Why OAuth is allowed now

An earlier draft rejected ChatGPT OAuth because the token would have to live in
the sandbox. `credential@1`'s `oauth` presentation removes that constraint: the
proxy intercepts `auth.openai.com/oauth/token`, serves sentinel tokens,
refreshes host-side, and substitutes the real bearer at the declared
`resourceHosts` (`chatgpt.com`). The sandbox sees only
`oai-oat01-proxy-managed` and `oai-ort01-proxy-managed`.

The cost is that OAuth-mode model calls have to route through the proxy rather
than the default OpenAI provider. `serve.sh` writes a `sandboxd`
`model_provider` with `base_url = "https://chatgpt.com/backend-api/codex"` and
`experimental_bearer_token` set to the sentinel. API-key mode keeps the default
provider and writes the sentinel to `auth.json` with
`codex login --with-api-key`.

## Why `auth.json` and not `OPENAI_API_KEY`

`codex app-server` starts with environment API-key auth disabled
(`enable_codex_api_key_env: false`), so an exported `OPENAI_API_KEY` is ignored
by the path t3 uses. `codex login --with-api-key` writes the sentinel to
`~/.codex/auth.json`, which the app-server does read. `kit/serve.sh` re-seeds it
on every start because `~/.codex` is not a volume.

## Considered Options

- **Let t3 manage the Codex install.** Rejected: a non-volume download that a
  `rebuild` discards, and a runtime install the pin cannot prove.
- **API key only.** Rejected: an OpenAI API key is not part of a ChatGPT
  subscription, so the user with a plan cannot use Codex at all.
- **ChatGPT OAuth with the token in the sandbox.** Rejected: the agent can read
  it. The proxy's OAuth presentation is the version that keeps the token out.
- **`credentialFile` for `auth.json`.** Not used: Codex's ChatGPT auth needs
  `id_token` and `account_id`, which the credential-file placeholders do not
  expose. The canonical Docker Codex kit instead writes the `sandboxd`
  provider with a sentinel bearer, and this kit follows that shape.
- **A separate `openai-codex` service name.** Rejected for now: `openai` is the
  name a user expects from `sbx secret set openai`. The cost is that pointing pi
  at openai too collides on `(openai, runtime)`; the README makes that a stated
  limit rather than a silent failure.

## Consequences

A Codex version bump is a `codexVersion` change and a `rebuild`. The `openai`
service is shared with pi, so pi stays on a different provider. The binding must
match the credential type: `api.openai.com` and `openai.com` for an API key;
`auth.openai.com` and `chatgpt.com` for OAuth. Codex's own sandbox and approval
rules still apply inside the microVM; the t3 thread's permission mode is what
selects full access. The skills CLI maps Codex's global skills to the same
`~/.agents/skills` directory as pi, so the baked skill set serves both.
