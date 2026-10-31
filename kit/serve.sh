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

# t3 spawns the UI's terminal from the server's $SHELL, and only falls back to
# bash when that spawn *fails* — which it never does here, because the platform
# starts the workload with SHELL=/bin/sh and /bin/sh is dash. A dash terminal is
# the bare one: no readline, so no history and no tab completion, and a prompt
# that never reads ~/.bashrc. Export bash so the terminal panel gets the shell
# the image was built for.
export SHELL=/bin/bash

# Not `exec`: the pipe to tee must survive, and tee must keep the log
# appendable across restarts. Signal handling is the sandbox's problem.
t3 serve \
  --host "${T3CODE_HOST:-0.0.0.0}" \
  --port "${T3CODE_PORT:-3773}" \
  --no-browser \
  2>&1 | tee -a "$log"
