// The error taxonomy the seam exposes.
//
// Each class is a `Schema.TaggedError` with structured attributes and a message
// built from those attributes. The taxonomy is the seam's contract: a caller
// switches on the tag, never on `stderr` text.
import * as Schema from "effect/Schema";

/** `sbx` is not installed, or `$SBX` points at something that cannot run. */
export class SbxNotFoundError extends Schema.TaggedError<
  SbxNotFoundError,
  { readonly brand: unique symbol }
>()("SbxNotFoundError", {
  searched: Schema.Array(Schema.String),
}) {
  override get message(): string {
    return `sbx was not found (searched ${this.searched.join(", ")}).`;
  }
}

/** `sbx secret ls` ran but the host is not signed in to Docker. The verb is
 * fixed, so it belongs in the message rather than in a single-valued attribute. */
export class SbxNotLoggedInError extends Schema.TaggedError<
  SbxNotLoggedInError,
  { readonly brand: unique symbol }
>()("SbxNotLoggedInError", {}) {
  override get message(): string {
    return "sbx secret ls needs a Docker sign-in.";
  }
}

/** The named sandbox instance does not exist. Distinct from a generic failure:
 * `nuke` must abort rather than report success when the instance is gone but
 * its volume contents may still be on disk. */
export class SandboxMissingError extends Schema.TaggedError<
  SandboxMissingError,
  { readonly brand: unique symbol }
>()("SandboxMissingError", {
  sandboxName: Schema.String,
  verb: Schema.String,
}) {
  override get message(): string {
    return `no sandbox named '${this.sandboxName}' (from sbx ${this.verb}).`;
  }
}

/** `create` refused because the name is already taken. */
export class SandboxExistsError extends Schema.TaggedError<
  SandboxExistsError,
  { readonly brand: unique symbol }
>()("SandboxExistsError", {
  sandboxName: Schema.String,
}) {
  override get message(): string {
    return `a sandbox named '${this.sandboxName}' already exists.`;
  }
}

/** The secret listing was read and the named secret is genuinely absent. */
export class SecretAbsentError extends Schema.TaggedError<
  SecretAbsentError,
  { readonly brand: unique symbol }
>()("SecretAbsentError", {
  secretName: Schema.String,
}) {
  override get message(): string {
    return `no '${this.secretName}' secret on this host.`;
  }
}

/** A volume operation is not available in the current mode. `sbx volume` is
 * cloud-only; the local seam has no per-sandbox purge. */
export class VolumeUnsupportedError extends Schema.TaggedError<
  VolumeUnsupportedError,
  { readonly brand: unique symbol }
>()("VolumeUnsupportedError", {
  mode: Schema.Literals(["local", "cloud"]),
}) {
  override get message(): string {
    return `volume operations are not available in ${this.mode} mode.`;
  }
}

/** A request from inside the sandbox was stopped by the egress proxy. It is a
 * 403 from the proxy, not a connection error; the body names the host. */
export class EgressBlockedError extends Schema.TaggedError<
  EgressBlockedError,
  { readonly brand: unique symbol }
>()("EgressBlockedError", {
  host: Schema.String,
}) {
  override get message(): string {
    return `egress to ${this.host} is blocked by the sandbox proxy.`;
  }
}

/** The bounded command did not finish in time. Distinct from a non-zero exit:
 * the remedy is a larger bound, not reading stderr. */
export class SbxTimeoutError extends Schema.TaggedError<
  SbxTimeoutError,
  { readonly brand: unique symbol }
>()("SbxTimeoutError", {
  verb: Schema.String,
  timeoutMs: Schema.Int,
}) {
  override get message(): string {
    return `sbx ${this.verb} timed out after ${this.timeoutMs}ms.`;
  }
}

/** The process never ran (`exitCode: null`) or ran and exited non-zero. */
export class SbxCommandError extends Schema.TaggedError<
  SbxCommandError,
  { readonly brand: unique symbol }
>()("SbxCommandError", {
  verb: Schema.String,
  exitCode: Schema.NullOr(Schema.Int),
  stderr: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return this.exitCode === null
      ? `sbx ${this.verb} could not run.`
      : `sbx ${this.verb} exited ${this.exitCode}.`;
  }
}

/** `sbx` printed something the seam could not parse. "sbx moved under us." */
export class SbxOutputError extends Schema.TaggedError<
  SbxOutputError,
  { readonly brand: unique symbol }
>()("SbxOutputError", {
  verb: Schema.String,
  field: Schema.String,
}) {
  override get message(): string {
    return `could not parse ${this.field} from sbx ${this.verb}.`;
  }
}
