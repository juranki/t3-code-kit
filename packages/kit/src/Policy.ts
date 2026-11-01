// `policy/allow.txt` is the readable mirror of the Kit's runtime egress
// allowlist. Parsing it is pure data work: the `policy` verb and the smoke
// suite both need the same list, and neither should own the format.
//
// A `#` starts a comment anywhere on a line, and blank lines are not entries.
// The file's own comments explain why the normative copy lives in the Kit
// descriptor.
export const parsePolicy = (text: string): ReadonlyArray<string> =>
  text
    .split(/\r?\n/u)
    .map((line) => line.replace(/#.*$/u, "").trim())
    .filter((line) => line.length > 0);
