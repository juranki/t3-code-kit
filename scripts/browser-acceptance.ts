// Browser acceptance owns the probe and its six decisions. Smoke supplies the
// sandbox instance, the Dockerfile-derived pin and the timeout, then presents
// the ordered results. Both live and scripted execution use the existing Sbx seam.
import { Sbx } from "@t3ck/sbx/Sbx";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";

export interface BrowserCheckResult {
  readonly status: "pass" | "fail" | "skip";
  readonly label: string;
}

/** `Google Chrome for Testing 156.0.8078.70` -> `156.0.8078.70`. Empty when the
 * binary never printed a version, which is what a launch failure looks like. */
const chromeVersionOf = (raw: string): string =>
  /Chrome for Testing (\d+(?:\.\d+)*)/u.exec(raw)?.[1] ?? "";

/** How much wider 8 `W`s render than 8 `I`s. A proportional font gives ~3.4;
 * tofu boxes give exactly 1, because every missing glyph advances by the same
 * width. That is the difference between "the page has text" and "the page has
 * boxes", which no font-file check can make. */
const glyphRatio = (glyphs: string): number | undefined => {
  const [narrow, wide] = glyphs.split(",").map((value) => Number.parseFloat(value));
  if (narrow === undefined || wide === undefined) return undefined;
  if (!Number.isFinite(narrow) || !Number.isFinite(wide) || narrow <= 0) return undefined;
  return wide / narrow;
};

/** The directory chrome-for-testing publishes for this machine, which is also
 * the one t3 installs under. Restated here rather than imported from the
 * Dockerfile: the point of the check is to compare the image against an
 * independent statement of where t3 looks, and a shared constant would only
 * compare the image with itself. `undefined` for a machine neither knows. */
const chromePlatformOf = (machine: string): string | undefined => {
  if (machine === "x86_64" || machine === "amd64") return "linux64";
  if (machine === "aarch64" || machine === "arm64") return "linux-arm64";
  return undefined;
};

/** One `sbx exec` that answers everything the browser section asserts. The
 * binary is found by glob rather than by a pinned path: the image pre-seeds it
 * under the version t3 names, and the arch directory differs by host. */
const browserProbeScript = (): string =>
  [
    "bin=$(ls -d /home/agent/.t3/tools/chrome-headless-shell/*/*/chrome-headless-shell 2>/dev/null | head -1)",
    'echo "bin=$bin"',
    'echo "machine=$(uname -m)"',
    'if [ -n "$bin" ]; then',
    '  echo "missing=$(ldd "$bin" 2>/dev/null | grep -c "not found")"',
    '  echo "version=$("$bin" --version 2>/dev/null)"',
    // Same count of a narrow and a wide glyph, measured by the browser itself.
    // Equal widths mean tofu; a proportional font means real outlines.
    `  glyphs=$("$bin" --headless --virtual-time-budget=3000 --dump-dom "data:text/html,<body><span id=a style='font:40px sans-serif'>IIIIIIII</span><span id=b style='font:40px sans-serif'>WWWWWWWW</span><script>document.title=[a.getBoundingClientRect().width,b.getBoundingClientRect().width].join(',')</script>" 2>/dev/null | grep -o "<title>[0-9.,]*</title>" | tr -d "<title>/")`,
    '  echo "glyphs=$glyphs"',
    // The sandbox proxy re-signs TLS with a per-sandbox CA, which serve.sh
    // imports into NSS. If that import did not happen, every https:// origin
    // fails with ERR_CERT_AUTHORITY_INVALID and the DOM never arrives.
    '  if "$bin" --headless --virtual-time-budget=5000 --dump-dom https://github.com 2>/dev/null | grep -q "<title>"; then echo "tls=ok"; else echo "tls="; fi',
    "fi",
    "font=$(fc-match --format=%{file} sans-serif 2>/dev/null)",
    // fc-match prints the pattern back when nothing matches, so "resolved" is
    // a path that is actually a file.
    'if [ -f "$font" ]; then echo "font=$font"; else echo "font="; fi',
  ].join("\n");

interface BrowserProbe {
  readonly bin: string | undefined;
  readonly machine: string | undefined;
  readonly missing: number | undefined;
  readonly version: string | undefined;
  readonly font: string | undefined;
  readonly glyphs: string | undefined;
  readonly tls: string | undefined;
}

/** The probe's `key=value` lines. An empty value is absent, not empty string:
 * `bin=` is what a sandbox without a pre-seeded browser reports. */
const parseBrowserProbe = (stdout: string): BrowserProbe => {
  const fields: Record<string, string> = {};
  for (const line of stdout.split(/\r?\n/u)) {
    const match = /^(bin|machine|missing|version|font|glyphs|tls)=(.*)$/u.exec(line.trim());
    if (match !== null && (match[2] ?? "").trim().length > 0)
      fields[match[1] ?? ""] = (match[2] ?? "").trim();
  }
  const missing = Number.parseInt(fields.missing ?? "", 10);
  return {
    bin: fields.bin,
    machine: fields.machine,
    missing: Number.isInteger(missing) ? missing : undefined,
    version: fields.version,
    font: fields.font,
    glyphs: fields.glyphs,
    tls: fields.tls,
  };
};

/** Probe once; a failed command contributes one failure and six skips.
 * A successful command evaluates every check independently, in launch order. */
export const checkBrowser = Effect.fn("BrowserAcceptance.checkBrowser")(function* ({
  name,
  expectedChrome: wantChrome,
  timeoutMs,
}: {
  readonly name: string;
  readonly expectedChrome: string | undefined;
  readonly timeoutMs: number;
}): Effect.fn.Return<ReadonlyArray<BrowserCheckResult>, never, Sbx> {
  const results: Array<BrowserCheckResult> = [];
  const add = (status: BrowserCheckResult["status"], label: string): void => {
    results.push({ status, label });
  };

  // t3 downloads chrome-headless-shell from storage.googleapis.com on first
  // render, and this kit's runtime policy refuses that host - so the image
  // pre-seeds the binary at the version the baked t3 names. These are the
  // assertions that the layer landed, in the order a launch fails: no binary,
  // then a loader that cannot find a library, then a binary that starts, then
  // fonts (a browser with no font renders empty boxes, not text).
  const sbx = yield* Sbx;
  const browserProbe = yield* sbx
    .exec({ name, argv: ["sh", "-c", browserProbeScript()], timeoutMs })
    .pipe(Effect.result);
  if (Result.isFailure(browserProbe) || browserProbe.success.exitCode !== 0) {
    // The checks below cannot say anything, so they are skipped rather than
    // dropped: a suite whose count silently shrinks hides the gap.
    add(
      "fail",
      `the browser probe failed (${Result.isFailure(browserProbe) ? browserProbe.failure.message : `exit ${browserProbe.success.exitCode}`})`,
    );
    for (const label of [
      "the preview browser is baked in where t3 looks",
      "ldd reports no missing libraries",
      "chrome-headless-shell starts",
      "fc-match resolves sans-serif to a font file",
      "the browser renders proportional glyphs",
      "the browser renders an HTTPS origin",
    ]) {
      add("skip", label);
    }
  } else {
    const probe = parseBrowserProbe(browserProbe.success.stdout);
    const wantPlatform = chromePlatformOf(probe.machine ?? "");
    const wantBin =
      wantChrome === undefined || wantPlatform === undefined
        ? undefined
        : `/home/agent/.t3/tools/chrome-headless-shell/${wantPlatform}/${wantChrome}/chrome-headless-shell`;

    if (wantChrome === undefined) {
      add("fail", "no CHROME_VERSION pin in kit/t3-code.dockerfile");
    } else if (probe.bin === undefined) {
      add("fail", "no chrome-headless-shell under ~/.t3/tools - the image did not bake it in");
    } else if (wantBin === undefined) {
      add("fail", `no chrome-for-testing platform for ${probe.machine ?? "unknown"}`);
    } else if (probe.bin !== wantBin) {
      // t3 looks in exactly this path; a binary anywhere else is one t3 ignores
      // and re-downloads, which the runtime policy refuses.
      add("fail", `the preview browser is at ${probe.bin}, want ${wantBin}`);
    } else {
      add("pass", `the preview browser is baked in at ${probe.bin}`);
    }

    if (probe.missing === undefined) {
      add("fail", "ldd could not be run against the preview browser");
    } else if (probe.missing === 0) {
      add("pass", "ldd reports no missing libraries");
    } else {
      add("fail", `ldd reports ${probe.missing} missing libraries`);
    }

    const gotChrome = chromeVersionOf(probe.version ?? "");
    if (wantChrome === undefined) {
      add("fail", "no CHROME_VERSION pin in kit/t3-code.dockerfile");
    } else if (gotChrome === wantChrome) {
      add("pass", `chrome-headless-shell ${gotChrome} starts`);
    } else {
      add(
        "fail",
        `chrome-headless-shell reports ${gotChrome || "nothing"}, want ${wantChrome} (the Dockerfile pin)`,
      );
    }

    if (probe.font !== undefined) {
      add("pass", `fc-match resolves sans-serif to ${probe.font}`);
    } else {
      add("fail", "fc-match does not resolve sans-serif to a font file");
    }

    // A font file on disk is not the same as a glyph on screen: this is the
    // browser's own text measurement, so a fontconfig cache problem that leaves
    // the browser drawing boxes fails here and not in someone's screenshot.
    const ratio = glyphRatio(probe.glyphs ?? "");
    if (ratio === undefined) {
      add("fail", "the browser did not report a text measurement");
    } else if (ratio > 1.5) {
      add("pass", `the browser renders proportional glyphs (W/I width ${ratio.toFixed(1)})`);
    } else {
      add(
        "fail",
        `the browser renders every glyph at one width (W/I ${ratio.toFixed(1)}) - boxes, not text`,
      );
    }

    // The sandbox proxy re-signs TLS with a CA minted per sandbox, and Chromium
    // does not read SSL_CERT_FILE: serve.sh imports that CA into the NSS store
    // the browser does read. Without it every https:// origin is a certificate
    // error, which breaks any preview that pulls a CDN resource.
    if (probe.tls === "ok") {
      add("pass", "the browser renders an HTTPS origin (github.com)");
    } else {
      add(
        "fail",
        "the browser cannot render an HTTPS origin - the proxy CA is not in its NSS store (see kit/serve.sh)",
      );
    }
  }

  return results;
});
