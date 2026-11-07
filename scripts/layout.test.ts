// Repo-level invariants for the v2 workspace
// (docs/adr/0002-v2-workspace-layout-and-distribution.md). Each one is a
// decision a later change would erode silently, so it is asserted rather than
// described.
// This file also proves the toolchain the ADR claims: a root-level program
// resolving a workspace package through its subpath export, under `it.effect`.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "@effect/vitest";
import * as HostProcess from "@t3ck/host/HostProcess";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

// The manifest fields these invariants read. `Schema.Struct` ignores the rest,
// so a package.json may carry anything else without breaking the layout suite.
const Manifest = Schema.Struct({
  name: Schema.optional(Schema.String),
  private: Schema.optional(Schema.Boolean),
  exports: Schema.optional(
    Schema.Record(Schema.String, Schema.Struct({ import: Schema.optional(Schema.String) })),
  ),
  dependencies: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  devDependencies: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  engines: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  overrides: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  main: Schema.optional(Schema.String),
  types: Schema.optional(Schema.String),
  files: Schema.optional(Schema.Array(Schema.String)),
  bin: Schema.optional(Schema.Unknown),
});

type Manifest = typeof Manifest.Type;

const root = join(import.meta.dirname, "..");

const readManifest = (path: string): Manifest =>
  Schema.decodeUnknownSync(Manifest)(JSON.parse(readFileSync(join(root, path), "utf8")));

const workspaceDirs = [
  ...readdirSync(join(root, "packages")).map((name) => `packages/${name}`),
  ...readdirSync(join(root, "apps")).map((name) => `apps/${name}`),
];

const workspace = workspaceDirs.map((dir) => ({
  dir,
  manifest: readManifest(`${dir}/package.json`),
}));

const rootManifest = readManifest("package.json");

const descriptorText = () => readFileSync(join(root, "kit/t3-code.yaml"), "utf8");
const dockerfileText = () => readFileSync(join(root, "kit/t3-code.dockerfile"), "utf8");
const descriptorDefault = (key: string) =>
  new RegExp(`${key}:\\s*\\n\\s*default:\\s*"([^"]+)"`).exec(descriptorText())?.[1];
const dockerfileArg = (key: string) => new RegExp(`ARG ${key}=(\\S+)`).exec(dockerfileText())?.[1];

const internalDependencies = (manifest: Manifest): ReadonlyArray<string> =>
  Object.keys({ ...manifest.dependencies, ...manifest.devDependencies })
    .filter((name) => name.startsWith("@t3ck/"))
    .toSorted((a, b) => a.localeCompare(b));

// The import graph the layout exists to make possible: libraries depend on
// libraries, the program depends on all of them, nothing depends on the program.
const EXPECTED_EDGES: Record<string, ReadonlyArray<string>> = {
  "@t3ck/host": [],
  "@t3ck/kit": [],
  "@t3ck/sbx": ["@t3ck/host"],
  "@t3ck/cli": ["@t3ck/host", "@t3ck/kit", "@t3ck/sbx"],
};

describe("v2 workspace layout", () => {
  it("declares exactly the four v2 packages", () => {
    const names = workspace.map((entry) => entry.manifest.name ?? `<unnamed: ${entry.dir}>`);
    expect(names.toSorted((a, b) => a.localeCompare(b))).toEqual([
      "@t3ck/cli",
      "@t3ck/host",
      "@t3ck/kit",
      "@t3ck/sbx",
    ]);
  });

  it("exports subpaths that point at source, never a build output", () => {
    for (const { dir, manifest } of workspace) {
      for (const [subpath, target] of Object.entries(manifest.exports ?? {})) {
        expect(subpath, `${dir} has a root export`).not.toBe(".");
        expect(target.import, `${dir}${subpath}`).toMatch(/^\.\/src\/.+\.ts$/);
      }
    }
  });

  it("has no publish surface", () => {
    for (const { dir, manifest } of workspace) {
      expect(manifest.private, dir).toBe(true);
      for (const field of ["main", "types", "files", "bin"] as const) {
        expect(manifest[field], `${dir} declares ${field}`).toBeUndefined();
      }
    }
  });

  it("wires the package graph the seam needs, and nothing else", () => {
    for (const { manifest } of workspace) {
      const name = manifest.name ?? "<unnamed>";
      const expected = EXPECTED_EDGES[name];
      expect(expected, `no expected edges for ${name}`).toBeDefined();
      expect(internalDependencies(manifest), name).toEqual(expected);
    }
  });

  it("has no shell or PowerShell launcher", () => {
    // #42 retired the `sh` and `ps1` twins; `npm run <verb>` is the interface.
    expect(existsSync(join(root, "bin"))).toBe(false);
  });

  it("pins one exact Node version, in one place", () => {
    expect(rootManifest.engines?.node).toBe("26.13.0");
    for (const { dir, manifest } of workspace) {
      expect(manifest.engines, `${dir} declares its own engines`).toBeUndefined();
    }
  });

  it("pins the dependencies that must never be duplicated", () => {
    expect(rootManifest.overrides?.effect).toBe("4.1.2");
    expect(rootManifest.overrides?.vitest).toBe("5.1.0");
    // Without this, npm installs registry vite for vitest's peer and nests
    // vite-plus's alias, so `vp test` runs against a second Vite.
    expect(rootManifest.overrides?.vite).toBe("npm:@voidzero-dev/vite-plus-core@1.5.0");
    // Without this, npm installs registry typescript for vite-plus-core's peer.
    // Linux merely warns; Windows fails the install outright.
    expect(rootManifest.overrides?.typescript).toBe("npm:@tsc-rs/typescript@0.8.0");
  });

  it.effect("resolves a workspace package through its subpath export", () =>
    Effect.gen(function* () {
      const platform = yield* HostProcess.Platform;
      expect(platform).toBe(process.platform);
    }),
  );

  it("bakes the same Node in the image as engines.node", () => {
    expect(descriptorDefault("nodeVersion")).toBe(rootManifest.engines?.node);
    expect(dockerfileArg("NODE_VERSION")).toBe(rootManifest.engines?.node);
  });

  it("bakes the Vite+ and fd pins the descriptor declares", () => {
    // Vite+ is the workspace's own devDependency, so the image pin must match
    // it; fd has no manifest pin, so the descriptor is the source of truth.
    expect(descriptorDefault("vitePlusVersion")).toBe(rootManifest.devDependencies?.["vite-plus"]);
    expect(dockerfileArg("VITE_PLUS_VERSION")).toBe(descriptorDefault("vitePlusVersion"));
    expect(dockerfileArg("FD_VERSION")).toBe(descriptorDefault("fdVersion"));
  });

  it("bakes the t3 pin the descriptor declares", () => {
    expect(dockerfileArg("T3_VERSION")).toBe(descriptorDefault("t3Version"));
  });

  it("bakes the Codex pin the descriptor declares", () => {
    // Codex has no manifest pin, so the descriptor is the source of truth and
    // the Dockerfile ARG must match it. A rebuild is the only way to move it.
    expect(dockerfileArg("CODEX_VERSION")).toBe(descriptorDefault("codexVersion"));
  });
});
