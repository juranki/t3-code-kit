#!/usr/bin/env bash
# Entrypoint for the sandbox: t3 serve, with stdout mirrored to a file.
#
# Two reasons this is a script and not `ENTRYPOINT ["t3", "serve"]`:
#   1. sbx has no `logs` verb, so the only way to read the server's output
#      after the fact is a file inside the sandbox.
#   2. The pairing token is printed once at startup; losing it means the
#      CLI has to mint a new one, which is slower than reading it.
set -uo pipefail

t3home="${T3CODE_HOME:-$HOME/.t3}"
log="$t3home/serve.log"
mkdir -p "$(dirname "$log")"
# Log to the same file t3's stdout goes to, so `npm run logs` shows the
# startup steps above the server output.
note() { printf -- '--- %s %s\n' "$(date -Is)" "$*" >>"$log"; }
note "t3 serve starting"

# t3 spawns the UI's terminal from the server's $SHELL, and only falls back to
# bash when that spawn *fails* — which it never does here, because the platform
# starts the workload with SHELL=/bin/sh and /bin/sh is dash. A dash terminal is
# the bare one: no readline, so no history and no tab completion, and a prompt
# that never reads ~/.bashrc. Export bash so the terminal panel gets the shell
# the image was built for.
export SHELL=/bin/bash

# Same reasoning for the locale, and the same reason it cannot be left to the
# image: a startup hook inherits only the variables its env list declares, and
# an unset locale means LC_ALL=C. In the C locale the terminal cannot type a
# non-ASCII character and renders correct UTF-8 as mojibake - `Ränkimies` shows
# up as `R├ñnkimies`. C.UTF-8 is the one UTF-8 locale glibc always has without a
# locale-gen step.
#
# Defaulted, not forced: a user who sets LANG deliberately keeps it.
export LANG=${LANG:-C.UTF-8}
export LC_ALL=${LC_ALL:-C.UTF-8}

# Refresh pi's model catalog before the server starts. Best-effort on purpose:
# a blocked or slow pi.dev must not keep the server from starting, because the
# catalog baked into the image is a usable fallback. pi has its own 15s
# timeout; `timeout` is the backstop for a process that never returns. 124 is
# its timeout exit status. Both failures are logged and stepped over.
if timeout 20 pi update --models >>"$log" 2>&1; then
  note "model catalog refreshed"
else
  rc=$?
  if [ "$rc" -eq 124 ]; then
    note "model catalog refresh timed out after 20s; using the catalog baked into the image"
  else
    note "model catalog refresh failed (exit $rc); using the catalog baked into the image"
  fi
fi

# t3 caches the upstream manifest with a fetchedAtMs; drop it so this start
# fetches instead of reusing the bundled fallback. Missing is fine.
manifest="$t3home/userdata/model-manifest.json"
if rm -f "$manifest"; then
  note "cleared t3's cached model manifest"
else
  note "could not clear $manifest; t3 may reuse its cached model manifest"
fi

# Codex reads credentials from ~/.codex/auth.json, not from OPENAI_API_KEY:
# `codex app-server` starts with environment API-key auth disabled. The kit
# declares both an API key and OAuth for `openai`; sbx surfaces which one the
# host bound as SBX_CRED_OPENAI_MODE. Re-seeding on every start is what makes a
# rebuild work, because ~/.codex is not a volume.
#
#   oauth  -> a custom model_provider points Codex at the proxy
#             (chatgpt.com/backend-api/codex) with the sentinel bearer. The
#             proxy swaps in the real ChatGPT token; none enters the sandbox.
#   apikey -> the default provider, with the sentinel written to auth.json by
#             `codex login --with-api-key`; the proxy swaps it at
#             api.openai.com.
#   none   -> no auth.json, so t3 shows Codex as unauthenticated.
#
# This overwrites a manual `codex login` or config by design: the kit owns
# ~/.codex, and a real ChatGPT token in the sandbox is what the proxy exists to
# avoid.
if command -v codex >/dev/null 2>&1; then
  codex_home="${CODEX_HOME:-$HOME/.codex}"
  codex_mode="${SBX_CRED_OPENAI_MODE:-none}"
  mkdir -p "$codex_home"
  cat >"$codex_home/config.toml" <<'EOF'
approval_policy = "never"
sandbox_mode = "danger-full-access"
EOF
  case "$codex_mode" in
    oauth)
      cat >>"$codex_home/config.toml" <<'EOF'
forced_login_method = "api"
model_provider = "sandboxd"

[model_providers.sandboxd]
name = "Sandbox Proxy"
base_url = "https://chatgpt.com/backend-api/codex"
experimental_bearer_token = "oai-oat01-proxy-managed"
requires_openai_auth = false
EOF
      printf '{"OPENAI_API_KEY":"proxy-managed"}\n' >"$codex_home/auth.json"
      note "codex is in ChatGPT OAuth mode through the proxy"
      ;;
    apikey)
      printf 'forced_login_method = "api"\n' >>"$codex_home/config.toml"
      if [ -z "${CODEX_API_KEY:-}" ]; then
        rm -f "$codex_home/auth.json"
        note "codex has no openai binding; it will show as unauthenticated in t3"
      elif printf '%s' "$CODEX_API_KEY" | codex login --with-api-key >>"$log" 2>&1; then
        note "codex is signed in with the proxy-managed API key"
      else
        note "codex login failed; Codex will show as unauthenticated in t3"
      fi
      ;;
    *)
      rm -f "$codex_home/auth.json"
      note "codex has no openai binding; it will show as unauthenticated in t3"
      ;;
  esac
fi

# Chromium does not read SSL_CERT_FILE or NODE_EXTRA_CA_CERTS: it verifies TLS
# against the NSS platform store at $HOME/.pki/nssdb. The sandbox proxy
# re-signs every connection with a CA minted per sandbox, so without this the
# preview browser fails every https:// origin with
# ERR_CERT_AUTHORITY_INVALID - while curl and Node in the same sandbox are fine,
# because they do read the bundle. The CA cannot be baked into the image (it
# differs per sandbox), and /home/agent/.pki is not a volume, so it is imported
# on every start rather than trusted stale.
#
# Importing into the browser *profile* does not work - that is not the trust
# store - and neither does --ignore-certificate-errors, which would stop
# verifying real certificates too. This trusts exactly the CA that curl and
# Node already trust, and nothing else.
#
# Best-effort: a browser that cannot reach HTTPS is a degraded preview, not a
# reason to keep the server from starting.
if [ -n "${PROXY_CA_CERT_B64:-}" ] && command -v certutil >/dev/null 2>&1; then
  nssdb="$HOME/.pki/nssdb"
  ca="$(mktemp)"
  mkdir -p "$nssdb"
  if printf '%s' "$PROXY_CA_CERT_B64" | base64 -d >"$ca" 2>/dev/null; then
    [ -f "$nssdb/cert9.db" ] || certutil -d "sql:$nssdb" -N --empty-password >/dev/null 2>&1
    # Delete first: a restart of the same sandbox carries the same CA, and
    # `-A` refuses a nickname that is already there.
    certutil -d "sql:$nssdb" -D -n "Docker Sandboxes Proxy CA" >/dev/null 2>&1
    if certutil -d "sql:$nssdb" -A -t "C,," -n "Docker Sandboxes Proxy CA" -i "$ca" >/dev/null 2>&1; then
      note "imported the sandbox proxy CA into NSS for the preview browser"
    else
      note "could not import the sandbox proxy CA; https previews will fail with ERR_CERT_AUTHORITY_INVALID"
    fi
  else
    note "PROXY_CA_CERT_B64 is not valid base64; https previews will fail"
  fi
  rm -f "$ca"
fi

# Not `exec`: the pipe to tee must survive, and tee must keep the log
# appendable across restarts. Signal handling is the sandbox's problem.
t3 serve \
  --host "${T3CODE_HOST:-0.0.0.0}" \
  --port "${T3CODE_PORT:-3773}" \
  --no-browser \
  2>&1 | tee -a "$log"
