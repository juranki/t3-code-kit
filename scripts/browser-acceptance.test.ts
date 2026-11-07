import { describe, expect, it } from "@effect/vitest";
import { make as makeFakeSbx, type FakeResponse } from "@t3ck/sbx/fake";
import * as Effect from "effect/Effect";

import { checkBrowser, type BrowserCheckResult } from "./browser-acceptance.ts";

const chrome = "156.0.8078.70";
const browser = `/home/agent/.t3/tools/chrome-headless-shell/linux64/${chrome}/chrome-headless-shell`;
const healthyFields = {
  bin: browser,
  machine: "x86_64",
  missing: "0",
  version: `Google Chrome for Testing ${chrome}`,
  font: "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
  glyphs: "88.90625,302.03125",
  tls: "ok",
};

const probeOutput = (fields: Readonly<Record<string, string>> = {}): string =>
  Object.entries({ ...healthyFields, ...fields })
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

const healthyResults: ReadonlyArray<BrowserCheckResult> = [
  `the preview browser is baked in at ${browser}`,
  "ldd reports no missing libraries",
  `chrome-headless-shell ${chrome} starts`,
  `fc-match resolves sans-serif to ${healthyFields.font}`,
  "the browser renders proportional glyphs (W/I width 3.4)",
  "the browser renders an HTTPS origin (github.com)",
].map((label) => ({ status: "pass", label }));

interface AcceptanceFailure {
  readonly scenario: string;
  readonly fields: Readonly<Record<string, string>>;
  readonly index: number;
  readonly label: string;
}

const acceptanceFailures: ReadonlyArray<AcceptanceFailure> = [
  {
    scenario: "missing binary",
    fields: { bin: "" },
    index: 0,
    label: "no chrome-headless-shell under ~/.t3/tools - the image did not bake it in",
  },
  {
    scenario: "wrong binary location",
    fields: { bin: "/usr/bin/chrome-headless-shell" },
    index: 0,
    label: `the preview browser is at /usr/bin/chrome-headless-shell, want ${browser}`,
  },
  {
    scenario: "unsupported architecture",
    fields: { machine: "riscv64" },
    index: 0,
    label: "no chrome-for-testing platform for riscv64",
  },
  {
    scenario: "missing architecture",
    fields: { machine: "" },
    index: 0,
    label: "no chrome-for-testing platform for unknown",
  },
  {
    scenario: "missing loader result",
    fields: { missing: "" },
    index: 1,
    label: "ldd could not be run against the preview browser",
  },
  {
    scenario: "missing libraries",
    fields: { missing: "3" },
    index: 1,
    label: "ldd reports 3 missing libraries",
  },
  {
    scenario: "wrong browser version",
    fields: { version: "Google Chrome for Testing 155.0.1.0" },
    index: 2,
    label: `chrome-headless-shell reports 155.0.1.0, want ${chrome} (the Dockerfile pin)`,
  },
  {
    scenario: "browser did not launch",
    fields: { version: "" },
    index: 2,
    label: `chrome-headless-shell reports nothing, want ${chrome} (the Dockerfile pin)`,
  },
  {
    scenario: "missing font",
    fields: { font: "" },
    index: 3,
    label: "fc-match does not resolve sans-serif to a font file",
  },
  {
    scenario: "fixed-width glyphs",
    fields: { glyphs: "100,100" },
    index: 4,
    label: "the browser renders every glyph at one width (W/I 1.0) - boxes, not text",
  },
  {
    scenario: "glyph ratio at the rejection threshold",
    fields: { glyphs: "100,150" },
    index: 4,
    label: "the browser renders every glyph at one width (W/I 1.5) - boxes, not text",
  },
  {
    scenario: "failed HTTPS rendering",
    fields: { tls: "" },
    index: 5,
    label:
      "the browser cannot render an HTTPS origin - the proxy CA is not in its NSS store (see kit/serve.sh)",
  },
];

describe("browser acceptance", () => {
  it.effect("returns six ordered successes and uses one bounded, non-interactive exec", () => {
    const fake = makeFakeSbx({ fallback: { stdout: probeOutput() } });
    return Effect.gen(function* () {
      const results = yield* checkBrowser({
        name: "browser-check",
        expectedChrome: chrome,
        timeoutMs: 12_345,
      });
      expect(results).toEqual(healthyResults);
      expect(fake.commands).toHaveLength(1);
      expect(fake.commands[0]?.args.slice(0, 6)).toEqual([
        "--no-input",
        "exec",
        "browser-check",
        "--",
        "sh",
        "-c",
      ]);
      expect(fake.commands[0]?.args).toHaveLength(7);
      expect(fake.commands[0]?.timeoutMs).toBe(12_345);
      expect(fake.commands[0]?.tty).toBe(false);
    }).pipe(Effect.provide(fake.layer));
  });

  it.effect.each(acceptanceFailures)(
    "reports $scenario without skipping later checks",
    (failure) => {
      const fake = makeFakeSbx({ fallback: { stdout: probeOutput(failure.fields) } });
      return Effect.gen(function* () {
        const results = yield* checkBrowser({
          name: "browser-check",
          expectedChrome: chrome,
          timeoutMs: 60_000,
        });
        expect(results).toEqual(
          healthyResults.map((result, index) =>
            index === failure.index ? { status: "fail", label: failure.label } : result,
          ),
        );
      }).pipe(Effect.provide(fake.layer));
    },
  );

  it.effect.each(["", "nonsense", "0,100", "-1,100", "Infinity,100", "100,NaN"])(
    "rejects an absent or invalid glyph measurement: %s",
    (glyphs) => {
      const fake = makeFakeSbx({ fallback: { stdout: probeOutput({ glyphs }) } });
      return Effect.gen(function* () {
        const results = yield* checkBrowser({
          name: "browser-check",
          expectedChrome: chrome,
          timeoutMs: 60_000,
        });
        expect(results).toEqual(
          healthyResults.map((result, index) =>
            index === 4
              ? { status: "fail", label: "the browser did not report a text measurement" }
              : result,
          ),
        );
      }).pipe(Effect.provide(fake.layer));
    },
  );

  it.effect.each([
    { machine: "x86_64", platform: "linux64" },
    { machine: "amd64", platform: "linux64" },
    { machine: "aarch64", platform: "linux-arm64" },
    { machine: "arm64", platform: "linux-arm64" },
  ])("accepts the expected binary location for $machine", ({ machine, platform }) => {
    const bin = `/home/agent/.t3/tools/chrome-headless-shell/${platform}/${chrome}/chrome-headless-shell`;
    const fake = makeFakeSbx({ fallback: { stdout: probeOutput({ bin, machine }) } });
    return Effect.gen(function* () {
      const results = yield* checkBrowser({
        name: "browser-check",
        expectedChrome: chrome,
        timeoutMs: 60_000,
      });
      expect(results).toEqual([
        { status: "pass", label: `the preview browser is baked in at ${bin}` },
        ...healthyResults.slice(1),
      ]);
    }).pipe(Effect.provide(fake.layer));
  });

  it.effect("reports a missing pin for both location and version", () => {
    const fake = makeFakeSbx({ fallback: { stdout: probeOutput() } });
    return Effect.gen(function* () {
      const results = yield* checkBrowser({
        name: "browser-check",
        expectedChrome: undefined,
        timeoutMs: 60_000,
      });
      expect(results).toEqual(
        healthyResults.map((result, index) =>
          index === 0 || index === 2
            ? { status: "fail", label: "no CHROME_VERSION pin in kit/t3-code.dockerfile" }
            : result,
        ),
      );
    }).pipe(Effect.provide(fake.layer));
  });

  it.effect("evaluates all six checks when a successful probe returns no fields", () => {
    const fake = makeFakeSbx();
    return Effect.gen(function* () {
      const results = yield* checkBrowser({
        name: "browser-check",
        expectedChrome: chrome,
        timeoutMs: 60_000,
      });
      expect(results).toEqual(
        [
          "no chrome-headless-shell under ~/.t3/tools - the image did not bake it in",
          "ldd could not be run against the preview browser",
          `chrome-headless-shell reports nothing, want ${chrome} (the Dockerfile pin)`,
          "fc-match does not resolve sans-serif to a font file",
          "the browser did not report a text measurement",
          "the browser cannot render an HTTPS origin - the proxy CA is not in its NSS store (see kit/serve.sh)",
        ].map((label) => ({ status: "fail", label })),
      );
    }).pipe(Effect.provide(fake.layer));
  });

  const probeFailures: ReadonlyArray<{
    readonly scenario: string;
    readonly response: FakeResponse;
    readonly detail: string;
  }> = [
    { scenario: "nonzero exit", response: { exitCode: 7 }, detail: "exit 7" },
    {
      scenario: "timeout",
      response: { fail: "timeout" },
      detail: "sbx exec browser-check timed out after 12345ms.",
    },
    {
      scenario: "spawn failure",
      response: { fail: "not-found" },
      detail: "sbx was not found (searched fake).",
    },
    {
      scenario: "missing sandbox instance",
      response: { exitCode: 1, stderr: "error: sandbox 'browser-check' not found\n" },
      detail: "no sandbox named 'browser-check' (from sbx exec).",
    },
  ];

  it.effect.each(probeFailures)("reports one failure and six skips for $scenario", (failure) => {
    const fake = makeFakeSbx({ fallback: failure.response });
    return Effect.gen(function* () {
      const results = yield* checkBrowser({
        name: "browser-check",
        expectedChrome: undefined,
        timeoutMs: 12_345,
      });
      expect(results).toEqual([
        { status: "fail", label: `the browser probe failed (${failure.detail})` },
        ...[
          "the preview browser is baked in where t3 looks",
          "ldd reports no missing libraries",
          "chrome-headless-shell starts",
          "fc-match resolves sans-serif to a font file",
          "the browser renders proportional glyphs",
          "the browser renders an HTTPS origin",
        ].map((label) => ({ status: "skip", label })),
      ]);
      expect(fake.commands).toHaveLength(1);
    }).pipe(Effect.provide(fake.layer));
  });
});
