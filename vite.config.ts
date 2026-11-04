import "vite-plus/test/config";
import { recommended } from "@effect/tsgo/oxlint-presets";
import { defineConfig } from "vite-plus";

export default defineConfig({
  test: {
    environment: "node",
    // Fixture subprocesses must not inherit an outer task runner's cache policy.
    env: { VP_REMOTE_CACHE: "off", VP_REMOTE_CACHE_URL: "" },
    hookTimeout: 60_000,
    testTimeout: 60_000,
    allowOnly: !process.env.CI,
    // Flaky tests are fixed, not retried.
    retry: 0,
    // `repos/effect` is vendored reference source, not this workspace's code.
    // Its own tests must not join our run.
    exclude: ["**/node_modules/**", "**/dist/**", "repos/**"],
    fakeTimers: {
      toFake: [
        "setTimeout",
        "clearTimeout",
        "setInterval",
        "clearInterval",
        "setImmediate",
        "clearImmediate",
        "Date",
        "performance",
      ],
    },
  },
  fmt: {
    ignorePatterns: ["node_modules", "package-lock.json", "*.tsbuildinfo", "repos"],
    sortPackageJson: {},
  },
  lint: {
    ignorePatterns: ["node_modules", "package-lock.json", "*.tsbuildinfo", "repos"],
    plugins: ["eslint", "oxc", "unicorn", "typescript", "effecttsgo"],
    jsPlugins: ["./lint/rules.js"],
    // The Effect diagnostics are the project's own rule set, so the preset is
    // the base and the rules below pin the severities the TypeScript plugin
    // block used to claim. `recommended` turns Oxlint's type-aware mode on.
    extends: [recommended],
    categories: {
      correctness: "warn",
      suspicious: "warn",
      perf: "warn",
    },
    options: {
      reportUnusedDisableDirectives: "error",
      typeAware: true,
      typeCheck: false,
    },
    rules: {
      "eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
      "typescript/no-extraneous-class": "error",
      "oxc/no-accumulating-spread": "error",

      // The project's own conventions. `lint/README.md` maps each rule to the
      // sentence in AGENTS.md or docs/design/sbx-seam.md that it enforces.
      "t3ck/exec-vs-exec-checked": "error",
      "t3ck/host-process-only": "error",
      "t3ck/no-argv-join": "error",
      "t3ck/no-render-to-shell": "error",
      "t3ck/no-stderr-switch": "error",
      "t3ck/no-vendored-import": "error",

      // The 25 diagnostics the tsconfig plugin block declared as errors.
      "effecttsgo/any-unknown-in-error-context": "error",
      "effecttsgo/catch-unfailable-effect": "error",
      "effecttsgo/crypto-random-uuid": "error",
      "effecttsgo/deterministic-keys": "error",
      "effecttsgo/effect-fn-opportunity": "error",
      "effecttsgo/global-console": "error",
      "effecttsgo/global-date": "error",
      "effecttsgo/global-error-in-effect-catch": "error",
      "effecttsgo/global-error-in-effect-failure": "error",
      "effecttsgo/global-fetch": "error",
      // `preferSchemaOverJson` is deprecated in @effect/tsgo 0.67.1; the two
      // rules it was split into carry the same intent.
      "effecttsgo/global-json": "error",
      "effecttsgo/global-json-in-effect": "error",
      "effecttsgo/global-timers": "error",
      "effecttsgo/instance-of-schema": "error",
      "effecttsgo/leaking-requirements": "error",
      "effecttsgo/missing-effect-service-dependency": "error",
      "effecttsgo/node-builtin-import": "error",
      "effecttsgo/prefer-typed-schema-decoder": "error",
      "effecttsgo/redundant-map-error": "error",
      "effecttsgo/run-effect-inside-effect": "error",
      "effecttsgo/schema-struct-with-tag": "error",
      "effecttsgo/try-catch-in-effect-gen": "error",
      "effecttsgo/unknown-in-effect-catch": "error",
      "effecttsgo/unnecessary-effect-gen": "error",
      "effecttsgo/unnecessary-fail-yieldable-error": "error",
      "effecttsgo/unsafe-effect-type-assertion": "error",

      // Off in the plugin block, for the reasons recorded there.
      "effecttsgo/lazy-effect": "off",
      "effecttsgo/return-effect-in-gen": "off",
      "effecttsgo/schema-number": "off",
      "effecttsgo/strict-boolean-expressions": "off",
      "effecttsgo/strict-effect-provide": "off",
      "effecttsgo/unstable-api-usage": "off",
    },
    overrides: [
      {
        // HostProcess is the one module allowed to read Node globals: it is
        // where `process` and `node:os` are turned into references.
        files: ["packages/host/src/HostProcess.ts"],
        rules: { "effecttsgo/node-builtin-import": "off" },
      },
      {
        // The sbx probe is a host tool, not part of the workspace: it shells
        // out to `sbx` and reads the host filesystem, which is the whole
        // point of it. Wrapping that in Effect services would be a rewrite
        // of the thing under test.
        files: ["scripts/probe-sbx.ts"],
        rules: {
          "effecttsgo/global-date": "off",
          "effecttsgo/node-builtin-import": "off",
        },
      },
      {
        files: ["**/*.test.ts", "scripts/characterization/**"],
        rules: {
          "effecttsgo/effect-fn-opportunity": "off",
          "effecttsgo/global-json": "off",
          "effecttsgo/global-json-in-effect": "off",
          "effecttsgo/node-builtin-import": "off",
        },
      },
    ],
  },
});
