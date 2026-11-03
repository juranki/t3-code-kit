# Troubleshooting

Each heading is the symptom you are looking at. Under it: the fix, then why it
happened. The README indexes these by symptom.

## The model list is stale, or missing models that exist

Restart to force a refresh: `npm run refresh -- <name>`, or `down` then `up`.

Every start already tries. `kit/serve.sh` runs `pi update --models`
best-effort, then clears t3's cached `model-manifest.json` before `t3 serve`.

The refresh can fail quietly. A blocked or slow `pi.dev` is logged in
`/home/agent/.t3/serve.log`, and the sandbox falls back to the catalog baked
into the image. That catalog ages.

If the provider record in the UI still shows the old list, refresh it there.
t3 exposes that as `server.refreshProviders` in provider settings. A list that
is stale _after_ a restart is a t3 caching issue, not the sandbox.

t3 fetches its model manifest from `raw.githubusercontent.com`, and pi checks
its catalog on `pi.dev`. Both are in the allowlist for that reason. Check with
`sbx exec <name> -- curl -sI https://raw.githubusercontent.com/ | head -1`.

## The terminal in the UI has no history, no completion, and no colors

The sandbox was built before `kit/serve.sh` exported `SHELL=/bin/bash`. Run
`npm run rebuild -- <name>`.

t3 spawns that terminal from the server's `$SHELL`, and the platform starts the
workload with `SHELL=/bin/sh`. That is dash. It has no readline, so there is no
history and no tab completion, and its prompt never reads `~/.bashrc`.

`npm run smoke` reads the running server's environment and fails if it is not
bash.

## The provider answers `401 Invalid API Key` and the sandbox has `MISTRAL_API_KEY=proxy-managed`

The credential has no `inject` rule, so the proxy has nothing to swap the
sentinel _for_.

`inject` names the domain and the header the key belongs in. Its `domain`
cannot be a kit arg. Switching provider therefore means editing `provider`,
`providerApiKeyEnv`, and the `inject` block in `kit/t3-code.yaml` together, and
then approving the new domain's binding.

## An agent says it cannot reach an API

Egress is deny-by-default, and the proxy does not fail like a network. It
answers:

```
Approval required for api.example.com:443.
Review and respond with: sbx policy approval ls
```

Add the host to `kit/t3-code.yaml` (`network-policy@2`, `runtime.allow`) and to
`policy/allow.txt`. Then `npm run rebuild -- <name>`.

## The pairing URL does not open

Use the URL `up` printed. The CLI rewrites it to `http://localhost:<port>`.
The address `t3 serve` prints is the sandbox's outbound interface, which the
host cannot reach.

If `up` printed nothing, run `npm run logs -- <name>`.

## The Kit build fails with `dockerDesktopLinuxEngine: The system cannot find the file`

`sbx` tried the host's Docker Buildx. Unset `SBX_KIT_BUILDER` if you exported
it yourself. The CLI defaults to `SBX_KIT_BUILDER=sandbox`.

## The Kit build fails with `OCI exporter is not supported for the docker driver`

Same cause. The host Buildx driver cannot emit the OCI layout a Kit needs. Use
the builder sandbox: `$env:SBX_KIT_BUILDER = 'sandbox'`.

## The sandbox starts but the server never answers, and there is no `/home/agent/.t3/serve.log`

Nothing started the server. On Windows the usual cause is CRLF. A clone with
`core.autocrlf=true` rewrites `kit/serve.sh`, so the shebang becomes
`#!/usr/bin/env bash\r` and it fails to exec silently. `.gitattributes` forces
LF and the Dockerfile strips CR, but an existing clone needs re-checking out:

```powershell
git pull
git rm --cached -r . | Out-Null; git reset --hard
```

The kit declares `sbx@1` and starts `serve.sh` from a `lifecycle@1` startup
hook. The image entrypoint is not what runs a workload on the agent platform.

If you are editing the kit, keep the hook's `env` list complete. A hook sees
only the variables it declares, and a missing `HTTPS_PROXY` silently breaks all
egress.

## `capability com.docker.sandbox/<type>: json: unknown field "<field>"`

The descriptor used a field newer than your `sbx` build. Drop it.

The spec is experimental, and fields land between releases: `port@1`'s `family`
arrived 2026-10-26, for instance. Check the field's date in the
[spec repo history](https://github.com/docker/sandbox-kit-spec/commits/main/schema).
Everything else this kit uses dates from the initial release.

## `t3: No such file or directory` inside the sandbox

`/home/agent/.local/bin/t3` is a symlink into
`$T3CODE_HOME/runtime/versions/<v>/t3`. Volume all of `/home/agent/.t3` and the
volume shadows that install, so the symlink dangles. The kit volumes only
`userdata`, `projects`, and `worktrees`.

## Every `https://` page in the preview browser fails with `ERR_CERT_AUTHORITY_INVALID`

The sandbox was built before `kit/serve.sh` imported the proxy's CA. Run
`npm run rebuild -- <name>`.

Chromium does not read `SSL_CERT_FILE` or `NODE_EXTRA_CA_CERTS`. It verifies
TLS against the NSS store at `$HOME/.pki/nssdb`. The sandbox proxy re-signs
every connection with a CA minted per sandbox, so that CA has to be imported
there. `kit/serve.sh` imports `$PROXY_CA_CERT_B64` on every start.

Two things do not work. Importing the CA into the browser _profile_ is not the
trust store. `--ignore-certificate-errors` would stop verifying real
certificates too.

`npm run smoke` asserts that an HTTPS origin renders.

## `html_preview` fails with "This host is missing libraries T3's browser needs"

`npm run rebuild -- <name>`. The image bakes those libraries and the browser
binary, so a sandbox that reports them missing was built before that layer.

Do not run `sudo t3 browser setup` inside the sandbox. It reaches for
`apt-get`, and `deb.debian.org` is not in `runtime.allow`. It fails with a
proxy `403` that reads like a network outage. `/etc` is not a volume either, so
a runtime repair would not survive a restart. The image is the only durable
place.

A browser that is missing altogether (`no chrome-headless-shell under
~/.t3/tools`) is the same `rebuild`. t3 would otherwise download it from
`storage.googleapis.com`, which the runtime policy refuses.

## The sandbox will not start

Check `sbx ls`, then `sbx diagnose`. A Kit that fails to build usually means
the base image reference moved. It is the `BASE` arg at the top of
`kit/t3-code.dockerfile`.
