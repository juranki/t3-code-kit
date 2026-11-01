import { describe, expect, it } from "@effect/vitest";

import { parsePairingUrl, rewritePairingUrl } from "./pairing.ts";

describe("pairing URLs", () => {
  it("finds the first URL that carries a token", () => {
    expect(parsePairingUrl("Pairing URL: http://10.0.0.1:9999/pair#token=abc123\n")).toBe(
      "http://10.0.0.1:9999/pair#token=abc123",
    );
  });

  it("ignores a URL without a token", () => {
    expect(parsePairingUrl("http://localhost:3773/\n")).toBeUndefined();
  });

  it("rewrites the outbound address to the published loopback port", () => {
    expect(rewritePairingUrl("http://10.0.0.1:9999/pair#token=abc123", 40_773)).toBe(
      "http://localhost:40773/pair#token=abc123",
    );
  });

  it("rejects a URL without a token", () => {
    expect(rewritePairingUrl("http://localhost:3773/", 40_773)).toBeUndefined();
  });
});
