// A command is data, never a string. The seam builds one of these and hands it
// to the adapter; the live adapter turns it into `ProcessRunner.run`, and a
// fake records it. Nothing here ever joins argv into a shell command line, so a
// name with a space, a multi-line wipe script, or a URL with `&` stays one argv
// element.
import type { Command as HostCommand } from "@t3ck/host/ProcessRunner";

export type Command = HostCommand;

export const command = (input: {
  readonly bin: string;
  readonly args: ReadonlyArray<string>;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly cwd?: string;
  readonly tty?: boolean;
  readonly timeoutMs?: number;
}): Command => ({
  bin: input.bin,
  args: input.args,
  tty: input.tty ?? false,
  ...(input.env === undefined ? {} : { env: input.env }),
  ...(input.cwd === undefined ? {} : { cwd: input.cwd }),
  ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
});

const quote = (word: string): string =>
  /^[A-Za-z0-9_./:=@%+-]+$/u.test(word) ? word : `'${word.replaceAll("'", `'\\''`)}'`;

/** For logs and test output only. Never pass this to a shell. */
export const render = (input: Command): string => [input.bin, ...input.args].map(quote).join(" ");
