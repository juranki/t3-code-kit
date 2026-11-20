// Toolchain acceptance owns the in-sandbox environment and baked-pin checks.
// Smoke supplies the sandbox instance name, raw descriptor, skills manifest,
// and timeout, then presents the ordered results. Both live and scripted
// execution use the existing Sbx seam.
import { Sbx } from "@t3ck/sbx/Sbx";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";

export interface ToolchainCheckResult {
  readonly status: "pass" | "fail" | "skip";
  readonly label: string;
}

/** The descriptor's build-arg default, read the same way `scripts/layout.test.ts`
 * reads it. The kit descriptor is the source of truth, so acceptance never keeps
 * a second copy of a baked version. */
const argDefault = (descriptor: string, key: string): string | undefined =>
  new RegExp(`${key}:\\s*\\n\\s*default:\\s*"([^"]+)"`, "u").exec(descriptor)?.[1];

/** `kit/skills.txt`'s rule: one name per line, blank lines and `#` comments
 * ignored. `kit/skills.sh` is the shell copy; a Windows host has no sh. */
const countSkills = (manifest: string): number =>
  manifest
    .split(/\r?\n/u)
    .filter((line) => line.trim().length > 0 && !line.trimStart().startsWith("#")).length;

/** Normalize the three mise tools' version output. The descriptor pins exact
 * versions, so the comparison is a string equality after this. */
const versionOf = (tool: "node" | "go" | "python", raw: string): string => {
  if (tool === "node") return raw.trim().replace(/^v/u, "");
  if (tool === "go") return /go(\d+(?:\.\d+)*)/u.exec(raw)?.[1] ?? "";
  return /(\d+(?:\.\d+)*)/u.exec(raw)?.[1] ?? "";
};

const detailOf = (
  result: Result.Result<{ readonly exitCode: number }, { readonly message: string }>,
): string =>
  Result.isFailure(result) ? result.failure.message : `exit ${result.success.exitCode}`;

/** Check every baked-in tool, shim, pin, locale, dpkg state, mount, server
 * shell, and skill count inside the sandbox instance. */
export const checkToolchain = Effect.fn("ToolchainAcceptance.checkToolchain")(function* ({
  name,
  descriptor,
  skillsManifest,
  timeoutMs,
}: {
  readonly name: string;
  readonly descriptor: string;
  readonly skillsManifest: string;
  readonly timeoutMs: number;
}): Effect.fn.Return<ReadonlyArray<ToolchainCheckResult>, never, Sbx> {
  const sbx = yield* Sbx;
  const results: Array<ToolchainCheckResult> = [];
  const add = (status: ToolchainCheckResult["status"], label: string): void => {
    results.push({ status, label });
  };

  const exec = (argv: ReadonlyArray<string>) => sbx.exec({ name, argv, timeoutMs });

  const checkExec = (label: string, command: string): Effect.Effect<void> =>
    Effect.gen(function* () {
      const result = yield* exec(["sh", "-c", command]).pipe(Effect.result);
      if (Result.isFailure(result)) {
        add("fail", `${label}: ${result.failure.message}`);
      } else if (result.success.exitCode !== 0) {
        const stderr = result.success.stderr.trim();
        add(
          "fail",
          `${label}: exit ${result.success.exitCode}${stderr.length > 0 ? ` (${stderr})` : ""}`,
        );
      } else {
        add("pass", label);
      }
    });

  for (const command of ["t3 --version", "pi --version", "git --version", "mise --version"]) {
    yield* checkExec(command, command);
  }

  // A UTF-8 locale, or a terminal in the sandbox cannot type a non-ASCII
  // character and renders correct UTF-8 as mojibake. Checked by round-tripping
  // a real character rather than by reading $LANG: the variable being set is
  // not the same as the locale working.
  const utf8 = yield* exec(["sh", "-c", 'printf "\\303\\244" | od -An -c']).pipe(Effect.result);
  if (
    Result.isSuccess(utf8) &&
    utf8.success.exitCode === 0 &&
    /303\s+244/u.test(utf8.success.stdout)
  ) {
    add("pass", "non-ASCII bytes survive a round-trip");
  } else {
    add("fail", "non-ASCII bytes do not survive a round-trip");
  }

  const locale = yield* exec(["sh", "-c", 'printf "%s" "$LC_ALL"']).pipe(Effect.result);
  if (
    Result.isSuccess(locale) &&
    locale.success.exitCode === 0 &&
    /utf-?8/iu.test(locale.success.stdout)
  ) {
    add("pass", "sandbox locale is UTF-8");
  } else {
    add("fail", "sandbox locale is not UTF-8 (LC_ALL is not set to a UTF-8 locale)");
  }

  // mise's shims, not the base image's node / go / python. `sbx exec` runs a
  // non-interactive shell, which is exactly where `mise activate` would never
  // have fired - so this is the assertion that catches a PATH-ordering
  // regression here, instead of it surfacing later as "the agent used the
  // wrong node".
  const shimScript = [
    'echo "node=$(node --version 2>&1)"',
    'echo "go=$(go version 2>&1)"',
    'echo "python=$(python --version 2>&1)"',
    'echo "node_path=$(command -v node)"',
    'echo "go_path=$(command -v go)"',
    'echo "python_path=$(command -v python)"',
  ].join("\n");
  const shimResult = yield* exec(["sh", "-c", shimScript]).pipe(Effect.result);
  if (Result.isFailure(shimResult) || shimResult.success.exitCode !== 0) {
    add("fail", `could not read the mise shims: ${detailOf(shimResult)}`);
  } else {
    const fields: Record<string, string> = {};
    for (const line of shimResult.success.stdout.split(/\r?\n/u)) {
      const match = /^(node|go|python)(_path)?=(.*)$/u.exec(line.trim());
      if (match !== null) fields[`${match[1]}${match[2] ?? ""}`] = (match[3] ?? "").trim();
    }

    const checkShim = (tool: "node" | "go" | "python"): void => {
      const want = argDefault(descriptor, `${tool}Version`);
      const got = versionOf(tool, fields[tool] ?? "");
      const shimPath = fields[`${tool}_path`] ?? "";
      const expectedPath = `/home/agent/.local/share/mise/shims/${tool}`;
      if (want === undefined) {
        add("fail", `${tool}: no ${tool}Version default in kit/t3-code.yaml`);
      } else if (shimPath !== expectedPath) {
        add(
          "fail",
          `${tool} resolves to ${shimPath || "nothing"}, not the mise shim (${expectedPath})`,
        );
      } else if (got !== want) {
        add("fail", `${tool} reports ${got || "nothing"}, want ${want} (the baked version)`);
      } else {
        add("pass", `${tool} ${got} through the mise shim`);
      }
    };

    checkShim("node");
    checkShim("go");
    checkShim("python");
  }

  // Vite+ and fd are not mise's: Vite+ is a global npm install and fd is a
  // pinned release binary in /usr/local/bin. They follow the same rule as the
  // shims - the version reported inside the sandbox must be the descriptor's
  // default - so a kit-arg bump that misses the image fails here.
  const checkToolVersion = (
    label: string,
    command: string,
    key: string,
    pattern: RegExp,
  ): Effect.Effect<void> =>
    Effect.gen(function* () {
      const want = argDefault(descriptor, key);
      const result = yield* exec(["sh", "-c", command]).pipe(Effect.result);
      if (Result.isFailure(result)) {
        add("fail", `${label}: ${result.failure.message}`);
        return;
      }
      if (result.success.exitCode !== 0) {
        add("fail", `${label}: exit ${result.success.exitCode}`);
        return;
      }
      const got = pattern.exec(result.success.stdout)?.[1];
      if (want === undefined) {
        add("fail", `${label}: no ${key} default in kit/t3-code.yaml`);
      } else if (got !== want) {
        add("fail", `${label} reports ${got ?? "nothing"}, want ${want} (the baked version)`);
      } else {
        add("pass", `${label} ${got} is the baked version`);
      }
    });

  yield* checkToolVersion(
    "vp",
    "vp --version 2>/dev/null",
    "vitePlusVersion",
    /vp v(\d+(?:\.\d+)*)/u,
  );
  yield* checkToolVersion("fd", "fd --version", "fdVersion", /^fd (\d+(?:\.\d+)*)/mu);
  // Codex is the second agent t3 can drive. This only proves the binary and
  // its platform package are baked; enabling it in the UI and its credential
  // are the host's job, like pi's provider record.
  yield* checkToolVersion(
    "codex",
    "codex --version 2>/dev/null",
    "codexVersion",
    /^codex-cli (\d+(?:\.\d+)*)/mu,
  );
  // Claude Code is the third. The base image ships its own unpinned `claude`,
  // so this also proves the pinned npm install is the one on PATH.
  yield* checkToolVersion(
    "claude",
    "claude --version 2>/dev/null",
    "claudeCodeVersion",
    /^(\d+(?:\.\d+)*) \(Claude Code\)/mu,
  );

  // Java is the base image's OpenJDK 21, not mise's: mise-java.jdx.dev is not
  // in the allowlist and the base image already carries a JDK. This asserts the
  // PATH append actually reaches it. `java -version` writes to stderr.
  const java = yield* exec(["sh", "-c", "java -version"]).pipe(Effect.result);
  if (
    Result.isSuccess(java) &&
    java.success.exitCode === 0 &&
    /openjdk version "21/u.test(`${java.success.stdout}${java.success.stderr}`)
  ) {
    add("pass", "java -version is the base image's OpenJDK 21");
  } else {
    const first = Result.isSuccess(java)
      ? `${java.success.stdout}${java.success.stderr}`
          .split(/\r?\n/u)
          .find((line) => line.length > 0)
      : undefined;
    add("fail", `java -version is not OpenJDK 21: ${first ?? "nothing"}`);
  }

  // mise pulls ca-certificates-bundle, which ships its own copy of
  // /etc/ssl/certs/ca-certificates.crt. Without --force-confold dpkg stops at
  // the conffile prompt and leaves both packages in state iU: mise still runs,
  // but the next apt operation fails. dpkg --audit is the assertion that the
  // flag is there; replacing the bundle instead shows up as a TLS failure in
  // the egress check below.
  const auditScript = 'echo "audit=$(dpkg --audit 2>&1 | tr "\\n" " ")"';
  const audit = yield* exec(["sh", "-c", auditScript]).pipe(Effect.result);
  if (Result.isFailure(audit) || audit.success.exitCode !== 0) {
    add("fail", `dpkg --audit could not run: ${detailOf(audit)}`);
  } else {
    const auditText = /^audit=(.*)$/mu.exec(audit.success.stdout)?.[1]?.trim() ?? "";
    if (auditText.length === 0) {
      add("pass", "dpkg --audit is clean");
    } else {
      add("fail", `dpkg --audit reports unconfigured packages: ${auditText}`);
    }
  }

  const mount = yield* exec(["sh", "-c", "mountpoint -q /home/agent/workspace"]).pipe(
    Effect.result,
  );
  if (Result.isSuccess(mount) && mount.success.exitCode === 0) {
    add("pass", "/home/agent/workspace is a volume mount, not a host mount");
  } else {
    add("fail", "/home/agent/workspace is not a volume mount");
  }

  // The UI's terminal is whatever t3 spawns from the server's $SHELL, and the
  // platform starts the workload with SHELL=/bin/sh - dash, which has no
  // readline: no history, no completion, no prompt colors. serve.sh exports
  // bash. Read the *running* server's environment, not serve.sh: the failure
  // this catches is a server that started before the export existed. The
  // `(^|/)` matches the absolute release path t3's launcher execs (0.1.9+).
  const shellScript =
    'tr "\\0" "\\n" < /proc/$(pgrep -f "(^|/)t3 serve" | head -1)/environ 2>/dev/null | sed -n "s/^SHELL=//p"';
  const serverShell = yield* exec(["sh", "-c", shellScript]).pipe(Effect.result);
  const shellValue =
    Result.isSuccess(serverShell) && serverShell.success.exitCode === 0
      ? (serverShell.success.stdout
          .split(/\r?\n/u)
          .map((line) => line.trim())
          .find((line) => line.length > 0) ?? "")
      : "";
  if (shellValue === "/bin/bash") {
    add("pass", "t3 serve runs with SHELL=/bin/bash (the terminal has history and completion)");
  } else {
    add(
      "fail",
      `t3 serve has SHELL=${shellValue || "unknown"}: the UI terminal falls back to dash`,
    );
  }

  // Skills are baked into the image, and the Dockerfile already asserts the
  // count against kit/skills.txt. This is the other failure: an image built
  // before skills were baked in, or a RUN that never executed.
  const skillsWant = countSkills(skillsManifest);
  const skillsScript =
    'echo "skills=$(ls -1 /home/agent/.agents/skills 2>/dev/null | wc -l | tr -d " ")"';
  const skills = yield* exec(["sh", "-c", skillsScript]).pipe(Effect.result);
  const skillsHave =
    Result.isSuccess(skills) && skills.success.exitCode === 0
      ? Number.parseInt(/^skills=(\d+)$/mu.exec(skills.success.stdout)?.[1] ?? "", 10)
      : Number.NaN;
  if (skillsWant > 0 && skillsHave === skillsWant) {
    add("pass", `${skillsWant} skills baked in, kit/skills.txt agrees`);
  } else {
    add(
      "fail",
      `skills: ${Number.isNaN(skillsHave) ? 0 : skillsHave} baked in, ${skillsWant} in kit/skills.txt`,
    );
  }

  return results;
});
