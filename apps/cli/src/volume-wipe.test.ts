import { describe, expect, it } from "@effect/vitest";
import { VOLUME_PATHS } from "@t3ck/kit/Volumes";
import { make as makeFakeSbx, type FakeSbx } from "@t3ck/sbx/fake";
import * as Effect from "effect/Effect";
import { TestConsole } from "effect/testing";

import { wipeVolumeContents, type WipeOutcome } from "./volume-wipe.ts";

const scriptOf = (command: { readonly args: ReadonlyArray<string> }): string =>
  command.args.at(-1) ?? "";

// The seam puts the global `--no-input` before the verb.
const verb = (command: { readonly args: ReadonlyArray<string> }): string | undefined =>
  command.args[0] === "--no-input" ? command.args[1] : command.args[0];

const markerRule = {
  match: (command: { args: ReadonlyArray<string> }) =>
    verb(command) === "exec" &&
    scriptOf(command).includes(".t3ck-nuke-marker") &&
    scriptOf(command).includes(">"),
  response: { stdout: "" },
};

const wipeRule = {
  match: (command: { args: ReadonlyArray<string> }) =>
    verb(command) === "exec" && scriptOf(command).includes("-mindepth 1 -delete"),
  response: { stdout: "" },
};

const verifyRule = (survivors = "") => ({
  match: (command: { args: ReadonlyArray<string> }) =>
    verb(command) === "exec" && scriptOf(command).includes("[ ! -e"),
  response: { stdout: survivors },
});

const runWipe = (fake: FakeSbx): Effect.Effect<WipeOutcome> =>
  wipeVolumeContents("charprobe").pipe(Effect.provide(fake.layer));

const execCalls = (fake: FakeSbx) => fake.commands.filter((command) => verb(command) === "exec");

describe("wipeVolumeContents", () => {
  it.effect("marks, wipes as root, and verifies the four volumes", () => {
    const fake = makeFakeSbx({ rules: [markerRule, wipeRule, verifyRule()] });
    return Effect.gen(function* () {
      expect(yield* runWipe(fake)).toEqual({ kind: "clean" });
      const calls = execCalls(fake);
      expect(calls).toHaveLength(3);

      expect(calls[0]?.args.slice(0, 6)).toEqual([
        "--no-input",
        "exec",
        "charprobe",
        "--",
        "sh",
        "-c",
      ]);
      expect(calls[0]?.timeoutMs).toBe(5 * 60_000);
      const marker = scriptOf(calls[0]!);
      for (const path of VOLUME_PATHS) {
        expect(marker).toContain(`'${path}'/.t3ck-nuke-marker`);
      }

      expect(calls[1]?.args.slice(0, 8)).toEqual([
        "--no-input",
        "exec",
        "-u",
        "root",
        "charprobe",
        "--",
        "sh",
        "-c",
      ]);
      const wipe = scriptOf(calls[1]!);
      expect(wipe).toContain("pkill -f '^t3 serve'");
      expect(wipe).toContain("pkill -x pi");
      for (const path of VOLUME_PATHS) {
        expect(wipe).toContain(`find '${path}' -mindepth 1 -delete`);
      }
      // The deletions must be on disk before `rm --force`: the verify runs in
      // the same mount and cannot see that they are not.
      expect(wipe.trimEnd().endsWith("sync")).toBe(true);

      expect(calls[2]?.args.slice(0, 6)).toEqual([
        "--no-input",
        "exec",
        "charprobe",
        "--",
        "sh",
        "-c",
      ]);
      expect(scriptOf(calls[2]!)).toContain("[ ! -e");
    }).pipe(Effect.provide(TestConsole.layer));
  });

  it.effect("returns missing when the marker step says the sandbox is gone", () => {
    const fake = makeFakeSbx({
      rules: [
        {
          match: (command: { args: ReadonlyArray<string> }) =>
            verb(command) === "exec" && scriptOf(command).includes(".t3ck-nuke-marker"),
          response: { exitCode: 1, stderr: "error: sandbox 'charprobe' not found\n" },
        },
      ],
    });
    return Effect.gen(function* () {
      expect(yield* runWipe(fake)).toEqual({ kind: "missing" });
      expect(execCalls(fake)).toHaveLength(1);
    }).pipe(Effect.provide(TestConsole.layer));
  });

  it.effect("retries once when a marker survives, then returns dirty", () => {
    const fake = makeFakeSbx({
      rules: [markerRule, wipeRule, verifyRule("/home/agent/workspace/.t3ck-nuke-marker\n")],
    });
    return Effect.gen(function* () {
      expect(yield* runWipe(fake)).toEqual({
        kind: "dirty",
        detail: "surviving markers: /home/agent/workspace/.t3ck-nuke-marker",
      });
      expect(execCalls(fake)).toHaveLength(6);
      expect(yield* TestConsole.errorLines).toContain(
        "⚠️  wipe of 'charprobe' left data behind; retrying once",
      );
    }).pipe(Effect.provide(TestConsole.layer));
  });

  it.effect("returns dirty with the stderr when a step exits non-zero", () => {
    const fake = makeFakeSbx({
      rules: [
        markerRule,
        {
          match: (command: { args: ReadonlyArray<string> }) =>
            verb(command) === "exec" && scriptOf(command).includes("-mindepth 1 -delete"),
          response: { exitCode: 1, stderr: "find: permission denied\n" },
        },
      ],
    });
    return Effect.gen(function* () {
      expect(yield* runWipe(fake)).toEqual({
        kind: "dirty",
        detail: "find: permission denied",
      });
      // The retry is the module's policy: a failed step is retried once, so
      // marker + wipe run twice.
      expect(execCalls(fake)).toHaveLength(4);
      expect(yield* TestConsole.errorLines).toContain(
        "⚠️  wipe of 'charprobe' left data behind; retrying once",
      );
    }).pipe(Effect.provide(TestConsole.layer));
  });

  it.effect("returns dirty with the seam's message when the process never ran", () => {
    const fake = makeFakeSbx({
      rules: [
        {
          match: (command: { args: ReadonlyArray<string> }) =>
            verb(command) === "exec" && scriptOf(command).includes(".t3ck-nuke-marker"),
          response: { fail: "not-found" },
        },
      ],
    });
    return Effect.gen(function* () {
      expect(yield* runWipe(fake)).toEqual({
        kind: "dirty",
        detail: "sbx was not found (searched fake).",
      });
    }).pipe(Effect.provide(TestConsole.layer));
  });
});
