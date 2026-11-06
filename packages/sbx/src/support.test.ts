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
    // The real message, captured from sbx v0.50.1 on Windows.
    expect(isMissingSandbox("error: sandbox 't3ck-probe' not found")).toBe(true);
    expect(isMissingSandbox("no such sandbox: demo")).toBe(true);
    expect(isMissingSandbox("build failed")).toBe(false);
  });

  it("does not mistake a command missing inside the sandbox for a missing sandbox", () => {
    // `sbx exec` runs these, so their stderr is the sandbox's, not sbx's. All
    // three used to match a bare "not found" and report the instance as gone.
    expect(isMissingSandbox("sh: 1: curl: not found")).toBe(false);
    expect(isMissingSandbox('exec: "git": executable file not found in $PATH')).toBe(false);
    expect(isMissingSandbox("bash: t3: command not found")).toBe(false);
  });

  it("recognises a sign-in failure", () => {
    expect(isNotLoggedIn("not logged in")).toBe(true);
    expect(isNotLoggedIn("build failed")).toBe(false);
  });

  it("names the verb from the first two argv words", () => {
    expect(verbOf(command({ bin: "sbx", args: ["secret", "ls"] }))).toBe("secret ls");
  });

  it("skips the global --no-input flag when naming the verb", () => {
    expect(verbOf(command({ bin: "sbx", args: ["--no-input", "ls", "--json"] }))).toBe("ls");
  });
});
