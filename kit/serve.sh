#!/usr/bin/env bash
# Entrypoint for the sandbox: t3 serve, with stdout mirrored to a file.
#
# Two reasons this is a script and not `ENTRYPOINT ["t3", "serve"]`:
#   1. sbx has no `logs` verb, so the only way to read the server's output
#      after the fact is a file inside the sandbox.
#   2. The pairing token is printed once at startup; losing it means the
#      launcher has to mint a new one, which is slower than reading it.
set -uo pipefail

log="${T3CODE_HOME:-$HOME/.t3}/serve.log"
mkdir -p "$(dirname "$log")"
printf -- '--- %s t3 serve starting\n' "$(date -Is)" >>"$log"

# Not `exec`: the pipe to tee must survive, and tee must keep the log
# appendable across restarts. Signal handling is the sandbox's problem.
t3 serve \
  --host "${T3CODE_HOST:-0.0.0.0}" \
  --port "${T3CODE_PORT:-3773}" \
  --no-browser \
  2>&1 | tee -a "$log"
