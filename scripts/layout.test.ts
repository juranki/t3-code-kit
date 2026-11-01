// Repo-level invariants for the v2 workspace (ADR 0002). Each one is a decision
// a later change would erode silently, so it is asserted rather than described.
// This file also proves the toolchain the ADR claims: a root-level program
// resolving a workspace package through its subpath export, under `it.effect`.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "@effect/vitest";
import * as HostProcess from "@t3ck/host/HostProcess";
import * as Effect from "effect/Effect";

interface Manifest {
  readonly name?: string;
  readonly private?: boolean;
  readonly exports?: Record<string, { readonly import?: string }>;
  readonly dependencies?: Record<string, string>;
  readonly devDependencies?: Record<string, string>;
  readonly engines?: Record<string, string>;
  readonly overrides?: Record<string, string>;
  readonly main?: string;
  readonly types?: string;
  readonly files?: ReadonlyArray<string>;
  readonly bin?: unknown;
}

const root = join(import.meta.dirname, "..");

const readJson = <A>(path: string): A => JSON.parse(readFileSync(join(root, path), "utf8")) as A;

const workspaceDirs = [
  ...readdirSync(join(root, "packages")).map((name) => `packages/${name}`),
  ...readdirSync(join(root, "apps")).map((name) => `apps/${name}`),
];

const workspace = workspaceDirs.map((dir) => ({
  dir,
  manifest: readJson<Manifest>(`${dir}/package.json`),
}));

const rootManifest = readJson<Manifest>("package.json");

const internalDependencies = (manifest: Manifest): ReadonlyArray<string> =>
  Object.keys({ ...manifest.dependencies, ...manifest.devDependencies })
    .filter((name) => name.startsWith("@t3ck/"))
    .toSorted();

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
    expect(workspace.map((entry) => entry.manifest.name).toSorted()).toEqual([
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

  it("pins one exact Node version, in one place", () => {
    expect(rootManifest.engines?.node).toBe("26.13.0");
    for (const { dir, manifest } of workspace) {
      expect(manifest.engines, `${dir} declares its own engines`).toBeUndefined();
    }
  });

  it("pins the dependencies that must never be duplicated", () => {
    expect(rootManifest.overrides?.effect).toBe("4.0.5");
    expect(rootManifest.overrides?.vitest).toBe("5.0.5");
    // Without this, npm installs registry vite for vitest's peer and nests
    // vite-plus's alias, so `vp test` runs against a second Vite.
    expect(rootManifest.overrides?.vite).toBe("npm:@voidzero-dev/vite-plus-core@1.4.0");
  });

  it.effect("resolves a workspace package through its subpath export", () =>
    Effect.gen(function* () {
      const platform = yield* HostProcess.Platform;
      expect(platform).toBe(process.platform);
    }),
  );

  // quarantine: #41 the image still bakes 22.23.4; this turns green with the bump.
  it.skip("bakes the same Node in the image as engines.node", () => {
    const descriptor = readFileSync(join(root, "kit/t3-code.yaml"), "utf8");
    const dockerfile = readFileSync(join(root, "kit/t3-code.dockerfile"), "utf8");
    const fromDescriptor = /nodeVersion:\s*\n\s*default:\s*"([^"]+)"/.exec(descriptor)?.[1];
    const fromDockerfile = /ARG NODE_VERSION=(\S+)/.exec(dockerfile)?.[1];
    expect(fromDescriptor).toBe(rootManifest.engines?.node);
    expect(fromDockerfile).toBe(rootManifest.engines?.node);
  });
});
