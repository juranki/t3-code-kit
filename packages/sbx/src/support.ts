// Text helpers shared by the service and the adapters.
import * as PlatformError from "effect/PlatformError";

import type { Command } from "./command.ts";

export const MAX_ERROR_OUTPUT = 4_000;

// The verb words, for an error label. Not a command string: the seam never
// joins argv into something a shell could run.
//
// A leading flag is a global (`--no-input`), and a flag after the verb starts
// its arguments (`ls --json`), so neither is part of the name. Two words is the
// most a verb has (`secret ls`).
export const verbOf = (input: Command): string => {
  const words: Array<string> = [];
  for (const word of input.args) {
    if (word.startsWith("-")) {
      if (words.length === 0) continue;
      break;
    }
    if (words.length === 2) break;
    words.push(word);
  }
  return words.length === 0 ? input.bin : words.join(" ");
};

/** Token-shaped JSON values become `[redacted]` before they reach an error or
 * a log line. The exact value stays in `cause`. */
export const redact = (output: string): string =>
  output.replace(
    /("(?:access_token|bearerToken|credential|pairingToken|token)"\s*:\s*")[^"]+(")/giu,
    "$1[redacted]$2",
  );

export const bound = (output: string): string => {
  const redacted = redact(output);
  return redacted.length <= MAX_ERROR_OUTPUT
    ? redacted
    : `${redacted.slice(0, MAX_ERROR_OUTPUT)}\n[truncated]`;
};

/** `sbx` has no structured error codes, so these predicates are the quirk
 * boundary. Each one is a guess that the characterization suite and the host
 * probes exist to test.
 *
 * Verified against `sbx` v0.50.1 on Windows (`docs/research/sbx-probe-2026-11-01.log`):
 * `sbx exec|rm|stop <missing>` all print `error: sandbox '<name>' not found`.
 * `exec` exits 125, `rm` and `stop` exit 1, so the exit code cannot be the
 * discriminator on its own.
 *
 * The word "sandbox" is required. A command missing *inside* a sandbox also
 * prints "not found" (`sh: 1: curl: not found`, `bash: t3: command not found`,
 * exit 127) and the sandbox is very much there; matching a bare "not found"
 * reported those as a missing instance. */
export const isMissingSandbox = (stderr: string): boolean =>
  /\bsandbox\b[^\n]*\b(?:not found|does not exist)\b|\bno such sandbox\b|\bno sandbox\b/iu.test(
    stderr,
  );

export const isNotLoggedIn = (stderr: string): boolean =>
  /not logged in|sign in|unauthorized|authentication/iu.test(stderr);

export const isNotFound = (cause: unknown): boolean =>
  PlatformError.isPlatformError(cause) && cause.reason._tag === "NotFound";
