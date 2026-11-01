// Text helpers shared by the service and the adapters.
import * as PlatformError from "effect/PlatformError";

import type { Command } from "./command.ts";

export const MAX_ERROR_OUTPUT = 4_000;

export const verbOf = (input: Command): string => input.args.slice(0, 2).join(" ") || input.bin;

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
 * probes exist to test. */
export const isMissingSandbox = (stderr: string): boolean =>
  /no such sandbox|does not exist|not found|no sandbox/iu.test(stderr);

export const isNotLoggedIn = (stderr: string): boolean =>
  /not logged in|sign in|unauthorized|authentication/iu.test(stderr);

export const isNotFound = (cause: unknown): boolean =>
  PlatformError.isPlatformError(cause) &&
  // eslint-disable-next-line no-underscore-dangle -- _tag is Effect's discriminant
  cause.reason._tag === "NotFound";
