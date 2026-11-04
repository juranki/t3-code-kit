// The sandbox's git identity, derived from the host's own config.
//
// The name is decorated exactly once and the email is passed through untouched
// (docs/adr/0005-git-identity-from-host.md: the name is honesty, the email is
// what GitHub links on). The decoration is idempotent because `up` re-asserts
// the identity on every run
// and the value it reads is the host's *effective* config: a host whose global
// `user.name` was already set to the decorated value, or a sandbox used as a
// host, would otherwise collect one more prefix per run (#48).
import type { GitIdentity } from "@t3ck/host/Git";

/** The prefix `up` adds by default; `T3CK_AGENT_NAME_PREFIX` overrides it, and
 * an empty value is the documented opt-out to plain attribution. */
export const DEFAULT_AGENT_NAME_PREFIX = "Agent for ";

/** The prefix in force for a raw `T3CK_AGENT_NAME_PREFIX` value. One resolver,
 * so `up` and the smoke cannot disagree about the default. */
export const resolveAgentNamePrefix = (raw: string | undefined): string =>
  raw ?? DEFAULT_AGENT_NAME_PREFIX;

/** What `up` writes when the host has no git config at all. It names no person,
 * which is the point, and links to no account, which
 * docs/adr/0005-git-identity-from-host.md accepts. */
export const FALLBACK_NAME = "Agent";
export const FALLBACK_EMAIL = "agent@t3-code-kit";

/** `hostName` with exactly one `prefix` in front.
 *
 * Every *leading* copy of the prefix is stripped first, so the rule is
 * idempotent and self-correcting: `Agent for Agent for X` in, `Agent for X`
 * out. One strip is not enough - the bug this fixes was observed with 22
 * copies already in the host's config (#48). Only a leading copy is stripped,
 * so a name that merely contains the prefix keeps it. An empty prefix returns
 * the bare name. */
export const decorateAgentName = (prefix: string, hostName: string): string => {
  if (prefix.length === 0) return hostName;
  let bare = hostName;
  while (bare.startsWith(prefix)) bare = bare.slice(prefix.length);
  return `${prefix}${bare}`;
};

export interface SandboxIdentity {
  readonly name: string;
  readonly email: string;
  /** Both host fields were present, so `up` has nothing to warn about. */
  readonly hostConfigured: boolean;
}

const present = (value: string | undefined): string | undefined =>
  value !== undefined && value.length > 0 ? value : undefined;

/** The identity `up` asserts into the sandbox: the host's name decorated once,
 * the host's email as-is, and a nameless fallback when the host has neither. */
export const sandboxIdentity = (prefix: string, host: GitIdentity): SandboxIdentity => {
  const name = present(host.name);
  const email = present(host.email);
  return {
    name: name === undefined ? FALLBACK_NAME : decorateAgentName(prefix, name),
    email: email ?? FALLBACK_EMAIL,
    hostConfigured: name !== undefined && email !== undefined,
  };
};
