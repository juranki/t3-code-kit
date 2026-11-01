// What the seam learned about this `sbx` installation.
//
// The probe is where `sbx`'s quirks are named once. Callers ask the capability
// question instead of sniffing help text or version numbers themselves.
export type SbxMode = "local" | "cloud";

/** `sbx volume` is cloud-only. Local has no per-sandbox purge, only retention
 * and the in-sandbox wipe (ADR 0003). */
export type VolumeSupport = "unsupported" | "cloud-only" | "supported";

export type EgressModel = "deny-by-default" | "unknown";

export interface Capabilities {
  readonly mode: SbxMode;
  readonly version: string;
  readonly volumes: VolumeSupport;
  readonly rm: {
    readonly force: boolean;
    /** A per-sandbox purge flag. False on `sbx` v0.50.1. */
    readonly purge: boolean;
  };
  readonly egress: EgressModel;
  readonly secrets: boolean;
}
