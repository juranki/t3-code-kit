# Host setup

The kit automates the sandbox. Everything below is the host's, and cannot be
scripted: each step is a secret or an approval, and `sbx` deliberately refuses
to make those non-interactively. Skipping one does not fail loudly — it fails
as a withheld credential or a stale model list.

The README's [Install](../README.md#install) covers the critical path: `sbx
login`, the two secrets, and the first `sbx create` that approves the binding.
This page covers the rest.

## Once per host

| Step                                            | Why                                                              | Verify          |
| ----------------------------------------------- | ---------------------------------------------------------------- | --------------- |
| `sbx login`                                     | Docker OAuth; no sandbox runs without it                         | `sbx ls`        |
| `sbx secret set github`                         | the value git pushes with; the sandbox only ever sees a sentinel | `sbx secret ls` |
| `sbx secret set <provider>` (default `mistral`) | pi's model key                                                   | `sbx secret ls` |
| `sbx secret set openai`                         | Codex's OpenAI API key; only if you use Codex                    | `sbx secret ls` |
| `sbx secret set openai --oauth`                 | Codex on a ChatGPT plan instead of an API key                    | `sbx secret ls` |
| `sbx secret set anthropic`                      | Claude Code's Anthropic API key; only if you use Claude Code     | `sbx secret ls` |
| `/login` in sbx's own Claude sandbox (below)    | Claude Code on a Claude subscription instead of an API key       | `sbx secret ls` |
| Approve the credential binding                  | a stored secret is **not** an approval                           | see below       |

Codex accepts either credential. `sbx secret set openai` stores an API key;
`sbx secret set openai --oauth` stores ChatGPT OAuth tokens. The kit declares
both and reads `SBX_CRED_OPENAI_MODE` to decide which one the host bound. Use
`--force` to replace one with the other:

```powershell
sbx secret set openai --force          # replace OAuth with an API key
sbx secret set openai --oauth --force  # replace an API key with OAuth
```

In OAuth mode the proxy intercepts `auth.openai.com/oauth/token` and swaps the
sentinel bearer at `chatgpt.com`; no ChatGPT token enters the sandbox.

Claude Code works the same way with the `anthropic` service and
`SBX_CRED_ANTHROPIC_MODE`. In OAuth mode the proxy intercepts
`platform.claude.com/v1/oauth/token` and swaps the sentinel bearer at
`api.anthropic.com`; no subscription token enters the sandbox.

The difference is how a subscription gets stored. `sbx secret set anthropic
--oauth` refuses (`anthropic OAuth cannot be started from sbx secret set`).
Sign in once from sbx's built-in Claude sandbox instead; the proxy captures the
login on the host. Give it an empty directory, because `sbx run` mounts its
path argument:

```powershell
New-Item -ItemType Directory -Force $env:TEMP\claude-login | Out-Null
sbx run --name claude-login claude $env:TEMP\claude-login   # then /login, then exit
sbx secret ls                                               # anthropic: (oauth configured)
sbx rm claude-login
```

The stored subscription is global, so the kit's `anthropic` credential uses it
once its binding is approved. An API key is still `sbx secret set anthropic`.

### The binding is the step that bites

`sbx` records which kit may use which service and domain in
`%APPDATA%\sbx\credentials.yaml`, and only asks interactively. The CLI creates
sandboxes detached, so the first one starts with the credential withheld.
Either create the first sandbox by hand and answer the prompt:

```powershell
sbx create --name myproject -p 127.0.0.1:3773:3773 .\kit   # approve when asked
sbx run -d --name myproject
```

or write the binding yourself — this is the whole file, and the domains must
match the kit's `inject` rules and its egress allowlist:

```yaml
bindings:
  github:
    apiKey:
      domains: [api.github.com, github.com]
  mistral:
    apiKey:
      domains: [api.mistral.ai]
  # Codex with an API key:
  openai:
    apiKey:
      domains: [api.openai.com, openai.com]
  # ...or Codex on a ChatGPT plan:
  # openai:
  #   oauth:
  #     domains: [auth.openai.com, chatgpt.com]
  # Claude Code with an API key:
  anthropic:
    apiKey:
      domains: [api.anthropic.com]
  # ...or Claude Code on a Claude subscription:
  # anthropic:
  #   oauth:
  #     domains: [platform.claude.com, api.anthropic.com]
```

Use one `openai` block, matching the credential type in `sbx secret ls`. The
kit's `oauth` declaration adds `auth.openai.com` and `chatgpt.com`; the
`apiKey` declaration adds `api.openai.com` and `openai.com`.

The same goes for `anthropic`: one block, matching `sbx secret ls`.

`openai` is Codex's service and `anthropic` is Claude Code's. If you point pi at
either one too, both credentials would claim `(<service>, runtime)`; keep pi on
a different provider.

A malformed file breaks every `sbx` command, so delete it and re-approve rather
than hand-fixing it.

## If port 3773 is taken

Another sandbox on 3773 (including one running a T3 Code session) wins. Pick a
host port for the kit:

```powershell
$env:T3CK_PORT = 3774
```

```sh
export T3CK_PORT=3774
```

## If you cloned before `.gitattributes` existed

```powershell
git rm --cached -r . | Out-Null; git reset --hard
```

```sh
git rm --cached -r . && git reset --hard
```

Otherwise `kit/serve.sh` stays CRLF and the server never starts. The symptom is
in [Troubleshooting](troubleshooting.md).

## In the t3 UI, once per provider

- Add or enable a **pi provider instance**. The kit installs pi and starts t3;
  it does not create t3's provider records.
- **Codex** is baked, on `PATH`, and enabled by default. Set the `openai`
  secret (API key or `--oauth`) and approve its binding. On every start the kit
  seeds `~/.codex/config.toml` and `auth.json` from `SBX_CRED_OPENAI_MODE`:
  OAuth mode routes model calls through the proxy at
  `chatgpt.com/backend-api/codex`, API-key mode writes the sentinel to
  `auth.json`. If the provider card shows unauthenticated, check
  `sbx secret ls` and the `openai` binding, then `npm run logs -- <name>`.
- **Claude Code** is baked and on `PATH`; enable t3's Claude provider if it is
  not already on. Store the `anthropic` secret (an API key, or a subscription via `/login`
  as above) and approve
  its binding. On every start the kit writes `~/.claude/settings.json` from
  `SBX_CRED_ANTHROPIC_MODE` (an `apiKeyHelper` in API-key mode, none in OAuth
  mode) and seeds onboarding and workspace trust in `~/.claude.json`. If the
  provider card shows unauthenticated, check `sbx secret ls` and the
  `anthropic` binding, then `npm run logs -- <name>`.
- Refresh the provider's model list from provider settings
  (`server.refreshProviders`). This is t3's own state in `statev2.sqlite` and
  the one cache a shell cannot reach — `npm run refresh -- <name>` covers the
  other two.
