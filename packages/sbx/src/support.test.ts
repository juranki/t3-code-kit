import { describe, expect, it } from "@effect/vitest";

import { command } from "./command.ts";
import { bound, isMissingSandbox, isNotLoggedIn, redact, verbOf } from "./support.ts";

describe("support", () => {
  it("redacts token-shaped JSON values", () => {
    expect(redact('{"token":"secret","name":"x"}')).toBe('{"token":"[redacted]","name":"x"}');
  });

  it("bounds long output and says it truncated", () => {
    const result = bound("a".repeat(5_000));
    expect(result.length).toBeLessThan(4_100);
    expect(result).toContain("[truncated]");
  });

  it("recognises a missing sandbox", () => {
    expect(isMissingSandbox("no such sandbox: demo")).toBe(true);
    expect(isMissingSandbox("build failed")).toBe(false);
  });

  it("recognises a sign-in failure", () => {
    expect(isNotLoggedIn("not logged in")).toBe(true);
    expect(isNotLoggedIn("build failed")).toBe(false);
  });

  it("names the verb from the first two argv words", () => {
    expect(verbOf(command({ bin: "sbx", args: ["secret", "ls"] }))).toBe("secret ls");
  });
});
