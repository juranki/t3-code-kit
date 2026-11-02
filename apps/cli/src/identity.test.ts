import { describe, expect, it } from "@effect/vitest";

import {
  DEFAULT_AGENT_NAME_PREFIX,
  FALLBACK_EMAIL,
  FALLBACK_NAME,
  decorateAgentName,
  resolveAgentNamePrefix,
  sandboxIdentity,
} from "./identity.ts";

describe("resolveAgentNamePrefix", () => {
  it("defaults when the variable is unset", () => {
    expect(resolveAgentNamePrefix(undefined)).toBe(DEFAULT_AGENT_NAME_PREFIX);
  });

  it("keeps an empty value as the opt-out", () => {
    expect(resolveAgentNamePrefix("")).toBe("");
  });

  it("reads a custom prefix", () => {
    expect(resolveAgentNamePrefix("Bot ")).toBe("Bot ");
  });
});

describe("decorateAgentName", () => {
  it("adds the prefix to a bare host name", () => {
    expect(decorateAgentName("Agent for ", "Juhani Ränkimies")).toBe("Agent for Juhani Ränkimies");
  });

  it("leaves a name that already carries the prefix alone", () => {
    expect(decorateAgentName("Agent for ", "Agent for Juhani Ränkimies")).toBe(
      "Agent for Juhani Ränkimies",
    );
  });

  it("collapses every leading copy to one", () => {
    expect(decorateAgentName("Agent for ", "Agent for Agent for Agent for Juhani Ränkimies")).toBe(
      "Agent for Juhani Ränkimies",
    );
  });

  it("returns the bare name when the prefix is empty", () => {
    expect(decorateAgentName("", "Juhani Ränkimies")).toBe("Juhani Ränkimies");
  });

  it("honours a custom prefix, once", () => {
    expect(decorateAgentName("Bot ", "Bot Juhani Ränkimies")).toBe("Bot Juhani Ränkimies");
  });

  it("only strips a leading prefix, not one inside the name", () => {
    expect(decorateAgentName("Agent for ", "The Agent for Things")).toBe(
      "Agent for The Agent for Things",
    );
  });
});

describe("sandboxIdentity", () => {
  it("decorates the host's name and passes the email through", () => {
    expect(sandboxIdentity("Agent for ", { name: "Juhani", email: "j@example.com" })).toEqual({
      name: "Agent for Juhani",
      email: "j@example.com",
      hostConfigured: true,
    });
  });

  it("does not double-prefix a host that is already decorated", () => {
    expect(
      sandboxIdentity("Agent for ", { name: "Agent for Juhani", email: "j@example.com" }).name,
    ).toBe("Agent for Juhani");
  });

  it("falls back to a nameless identity when the host has no config", () => {
    expect(sandboxIdentity("Agent for ", { name: undefined, email: undefined })).toEqual({
      name: FALLBACK_NAME,
      email: FALLBACK_EMAIL,
      hostConfigured: false,
    });
  });

  it("does not prefix the fallback name", () => {
    expect(sandboxIdentity("Agent for ", { name: undefined, email: "j@example.com" }).name).toBe(
      FALLBACK_NAME,
    );
  });

  it("treats an empty host value as absent", () => {
    expect(sandboxIdentity("Agent for ", { name: "", email: "" })).toEqual({
      name: FALLBACK_NAME,
      email: FALLBACK_EMAIL,
      hostConfigured: false,
    });
  });
});
