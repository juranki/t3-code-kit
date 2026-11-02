import * as Console from "effect/Console";
import * as Effect from "effect/Effect";

// `rebuild` and `nuke` are deliberately absent until #39 lands them; the usage
// text must not advertise a verb the program does not answer to.
export const usage = (): Effect.Effect<void> =>
  Console.log(`usage: t3-code-kit <verb> [sandbox-name]

  up       create or start the sandbox, publish the port, print the pairing URL
  url      print the pairing URL for a running sandbox
  logs     tail the server log inside the sandbox
  shell    open a bash shell inside the sandbox
  refresh  restart, which also refreshes the model catalog
  down     stop the sandbox (volumes and repos survive)
  policy   print the runtime egress allowlist
  doctor   print the sbx capabilities this host reports

The sandbox name defaults to $T3CK_NAME. Host port defaults to $T3CK_PORT
(3773). The sbx binary defaults to $SBX.`);
