#!/usr/bin/env node
// The host's `git`, reduced to the two reads the launchers make. An unset key
// exits 1 with no output, which is the shape real git uses for "not
// configured"; anything else is a surprise worth failing on.
const argv = process.argv.slice(2);

if (argv[0] === "config" && argv[1] === "--get") {
  const key = argv[2];
  const value =
    key === "user.name"
      ? process.env.FAKE_GIT_NAME
      : key === "user.email"
        ? process.env.FAKE_GIT_EMAIL
        : undefined;

  if (value) {
    process.stdout.write(`${value}\n`);
    process.exitCode = 0;
  } else {
    process.exitCode = 1;
  }
} else {
  process.stderr.write(`fake git: unexpected call: ${argv.join(" ")}\n`);
  process.exitCode = 99;
}
