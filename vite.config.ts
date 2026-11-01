import "vite-plus/test/config";
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
    plugins: ["eslint", "oxc", "unicorn", "typescript"],
    categories: {
      correctness: "warn",
      suspicious: "warn",
      perf: "warn",
    },
    options: {
      reportUnusedDisableDirectives: "error",
      typeAware: false,
      typeCheck: false,
    },
    rules: {
      "eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
      "typescript/no-extraneous-class": "error",
      "oxc/no-accumulating-spread": "error",
    },
  },
});
