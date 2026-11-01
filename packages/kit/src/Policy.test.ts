import { describe, expect, it } from "@effect/vitest";

import { parsePolicy } from "./Policy.ts";

describe("parsePolicy", () => {
  it("strips comments, blank lines, and surrounding whitespace", () => {
    expect(parsePolicy("# comment\ngithub.com\n\napi.github.com # trailing\n  \n")).toEqual([
      "github.com",
      "api.github.com",
    ]);
  });
});
