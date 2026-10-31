#!/bin/sh
# The one parser for kit/skills.txt: one skill name per line, blank lines and
# `#` comments ignored. The Dockerfile bakes the names in and asserts the
# count; bin/smoke reads the count on the host. bin/smoke.ps1 carries a
# PowerShell port of the same rule, because a Windows host has no sh.
#
#   skills.sh names <skills.txt>   # the names, space-separated, for `--skill`
#   skills.sh count <skills.txt>   # how many names
set -eu

mode=${1:?usage: skills.sh names|count <skills.txt>}
file=${2:?usage: skills.sh names|count <skills.txt>}
[ -f "$file" ] || { printf 'skills.sh: no such file: %s\n' "$file" >&2; exit 1; }

case "$mode" in
  # Unquoted on purpose: the caller word-splits the names into --skill args.
  names) grep -ve '^[[:space:]]*#' -e '^[[:space:]]*$' "$file" | tr '\n' ' ' || true ;;
  # grep exits 1 when nothing matches; an empty selection is still an answer.
  count) grep -cve '^[[:space:]]*#' -e '^[[:space:]]*$' "$file" || true ;;
  *) printf 'skills.sh: unknown mode: %s\n' "$mode" >&2; exit 2 ;;
esac
