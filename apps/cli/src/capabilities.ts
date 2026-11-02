// The doctor's presentation of what the seam's probe learned. Pure formatting:
// the seam owns the facts, the CLI owns the wording, and the smoke suite prints
// the same lines so a host failure is attributable to the same capability set.
import type { Capabilities } from "@t3ck/sbx/capabilities";

export const renderCapabilities = (capabilities: Capabilities): ReadonlyArray<string> => [
  // `sbx version` already prints the leading `sbx version`, so this line is
  // the raw probe result and must not be prefixed again.
  capabilities.version,
  `mode: ${capabilities.mode}`,
  `volumes: ${capabilities.volumes}`,
  `rm: force=${capabilities.rm.force} purge=${capabilities.rm.purge}`,
  `egress: ${capabilities.egress}`,
  `secrets: ${capabilities.secrets}`,
];
