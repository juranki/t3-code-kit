#!/usr/bin/env node
// The CLI probes readiness with `curl`; this decides whether the
// server answered without binding a port or waiting.
process.exitCode = Number(process.env.FAKE_CURL_EXIT ?? "0");
