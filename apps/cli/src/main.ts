// The program: parse the verb, dispatch, and turn a `CliError` into the old
// launchers' `t3-code-kit: <reason>` line plus an exit code. Everything that
// touches the host is a service, so this module is importable by tests.
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import type * as FileSystem from "effect/FileSystem";
import type * as Path from "effect/Path";
import type * as Terminal from "effect/Terminal";

import type { Git } from "@t3ck/host/Git";
import type { ProcessRunner } from "@t3ck/host/ProcessRunner";
import type { Sbx } from "@t3ck/sbx/Sbx";

import { fail, type CliError } from "./cli.ts";
import { doctor } from "./doctor.ts";
import { usage } from "./usage.ts";
import { down, logs, nuke, policy, rebuild, refresh, shell, up, url } from "./verbs.ts";

export type CliEnvironment =
  | Sbx
  | Git
  | ProcessRunner
  | FileSystem.FileSystem
  | Path.Path
  | Terminal.Terminal;

export const run = (argv: ReadonlyArray<string>): Effect.Effect<number, never, CliEnvironment> =>
  Effect.gen(function* () {
    const [verb, ...args] = argv;
    if (verb === undefined) {
      yield* usage();
      return 2;
    }

    switch (verb) {
      case "help":
      case "-h":
      case "--help":
        yield* usage();
        return 0;
      case "up":
        return yield* up(args);
      case "url":
        return yield* url(args);
      case "logs":
        return yield* logs(args);
      case "shell":
        return yield* shell(args);
      case "refresh":
        return yield* refresh(args);
      case "down":
        return yield* down(args);
      case "rebuild":
        return yield* rebuild(args);
      case "nuke":
        return yield* nuke(args);
      case "policy":
        return yield* policy();
      case "doctor":
        return yield* doctor();
      default:
        return yield* fail(`unknown verb '${verb}' (try: t3-code-kit --help)`, 1);
    }
  }).pipe(
    Effect.catchTags({
      CliError: (error: CliError) =>
        Console.error(`t3-code-kit: ${error.reason}`).pipe(Effect.as(error.exitCode)),
    }),
  );
