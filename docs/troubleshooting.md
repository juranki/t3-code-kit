# Troubleshooting

Each entry is a symptom you can see, then the cause and the fix. The README
carries the three a first run is most likely to hit; everything else is here.

## The model list is stale, or missing models that exist

Every start of the sandbox attempts to refresh the catalog: `kit/serve.sh` runs
`pi update --models` best-effort and clears t3's cached `model-manifest.json`
before `t3 serve`.
Restart to force it: `npm run refresh -- <name>` (or `down` then `up`). The
refresh is best-effort — a blocked or slow `pi.dev` is logged in
`/home/agent/.t3/serve.log` and the sandbox falls back to the catalog baked
into the image, which ages. If the provider record in the UI still shows the
old list, refresh it there — t3 exposes that as `server.refreshProviders` in
provider settings. A model list that is stale _after_ a restart is a t3
caching issue, not the sandbox.

t3 fetches its model manifest from `raw.githubusercontent.com` and pi checks
its catalog on `pi.dev`; both are in the allowlist for that reason. Check with
`sbx exec <name> -- curl -sI https://raw.githubusercontent.com/ | head -1`.

## The terminal in the UI has no history, no completion, and no colors

t3 spawns that terminal from the server's `$SHELL`, and the platform starts the
workload with `SHELL=/bin/sh` — which is dash: no readline, so no history and
no tab completion, and a prompt that never reads `~/.bashrc`. `kit/serve.sh`
exports `/bin/bash` for exactly this reason, so a sandbox built before that
line existed needs a `rebuild`; `npm run smoke` reads the running server's
environment and fails if it is not bash.

## The provider answers `401 Invalid API Key` and the sandbox has `MISTRAL_API_KEY=proxy-managed`

The credential has no `inject` rule, so the proxy has nothing to swap the
sentinel _for_. `inject` names the domain and header the key belongs in; its
`domain` cannot be a kit arg, so switching provider means editing `provider`,
`providerApiKeyEnv`, and the `inject` block in `kit/t3-code.yaml` together —
and approving the new domain's binding.

## An agent says it cannot reach an API

Egress is deny-by-default and the proxy does not fail like a network. It
answers:

```
Approval required for api.example.com:443.
Review and respond with: sbx policy approval ls
```

Add the host to `kit/t3-code.yaml` (`network-policy@2`, `runtime.allow`) and to
`policy/allow.txt`, then `npm run rebuild -- <name>`.

## The pairing URL does not open

`t3 serve` prints the sandbox's outbound interface address, which the host
cannot reach; the CLI rewrites it to `http://localhost:<port>`. If `up` printed
nothing, run `npm run logs -- <name>`.

## The Kit build fails with `dockerDesktopLinuxEngine: The system cannot find the file`

`sbx` tried the host's Docker Buildx. The CLI defaults to
`SBX_KIT_BUILDER=sandbox`; if you exported `SBX_KIT_BUILDER` yourself, unset it.

## The Kit build fails with `OCI exporter is not supported for the docker driver`

Same cause — the host Buildx driver cannot emit the OCI layout a Kit needs. Use
the builder sandbox: `$env:SBX_KIT_BUILDER = 'sandbox'`.

## The sandbox starts but the server never answers, and there is no `/home/agent/.t3/serve.log`

Nothing started the server. The kit declares `sbx@1` and starts `serve.sh` from
a `lifecycle@1` startup hook, because the image entrypoint is not what runs a
workload on the agent platform. If you are editing the kit, keep the hook's
`env` list complete: a hook sees only the variables it declares, and a missing
`HTTPS_PROXY` silently breaks all egress. The usual cause on Windows is CRLF: a
clone with `core.autocrlf=true` rewrites `kit/serve.sh`, so the shebang becomes
`#!/usr/bin/env bash\r` and it fails to exec silently. `.gitattributes` forces
LF and the Dockerfile strips CR, but an existing clone needs re-checking out:

```powershell
git pull
git rm --cached -r . | Out-Null; git reset --hard
```

## `capability com.docker.sandbox/<type>: json: unknown field "<field>"`

The descriptor used a field newer than your `sbx` build. The spec is
experimental and fields land between releases — `port@1`'s `family` arrived
2026-10-26, for instance. Check the field's date in the
[spec repo history](https://github.com/docker/sandbox-kit-spec/commits/main/schema)
and drop it; everything this kit uses otherwise dates from the initial release.

## `t3: No such file or directory` inside the sandbox

`/home/agent/.local/bin/t3` is a symlink into `$T3CODE_HOME/runtime/versions/<v>/t3`.
If someone volumes all of `/home/agent/.t3`, the volume shadows that install
and the symlink dangles. The kit volumes only `userdata`, `projects`, and
`worktrees`.

## Every `https://` page in the preview browser fails with `ERR_CERT_AUTHORITY_INVALID`

Chromium does not read `SSL_CERT_FILE` or `NODE_EXTRA_CA_CERTS`; it verifies
TLS against the NSS store at `$HOME/.pki/nssdb`, and the sandbox proxy re-signs
every connection with a CA minted per sandbox. `kit/serve.sh` imports
`$PROXY_CA_CERT_B64` there on every start, so a sandbox built before that line
needs a `rebuild`; `npm run smoke` asserts that an HTTPS origin renders.
Importing the CA into the browser _profile_ does not work — that is not the
trust store — and `--ignore-certificate-errors` would stop verifying real
certificates too.

## `html_preview` fails with "This host is missing libraries T3's browser needs"

The image bakes those libraries and the browser binary, so a sandbox that
reports them missing was built before that layer: `npm run rebuild -- <name>`.
Do not run `sudo t3 browser setup` inside the sandbox — it reaches for
`apt-get`, and `deb.debian.org` is not in `runtime.allow`, so it fails with a
proxy `403` that reads like a network outage. `/etc` is not a volume, so a
runtime repair would not survive a restart anyway; the image is the only
durable place. A browser that is missing altogether (`no chrome-headless-shell
under ~/.t3/tools`) is the same `rebuild`: t3 would otherwise download it from
`storage.googleapis.com`, which the runtime policy refuses.

## The sandbox will not start

Check `sbx ls`, then `sbx diagnose`. A Kit that fails to build usually means
the base image reference moved — it is the `BASE` arg at the top of
`kit/t3-code.dockerfile`.
