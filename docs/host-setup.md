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
| Approve the credential binding                  | a stored secret is **not** an approval                           | see below       |

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
```

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
- Refresh its model list from provider settings (`server.refreshProviders`).
  This is t3's own state in `statev2.sqlite` and the one cache a shell cannot
  reach — `npm run refresh -- <name>` covers the other two.

## Nothing else is required

No Docker Desktop, no Docker Engine, no bash on Windows, and no PowerShell
launcher. The host needs Node 26.13.0 and Vite+ 1.4.0 (the Vite+ installer
provides both); PowerShell is only the Windows shell you happen to type in. If
you exported `SBX_KIT_BUILDER` yourself at some point, unset it: the CLI
defaults to the builder sandbox, and `host` fails on a machine without a
running Buildx.
