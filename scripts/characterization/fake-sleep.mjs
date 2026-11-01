#!/usr/bin/env node
// The readiness loop sleeps between probes. The suite drives the timeout with
// T3CK_READY_TIMEOUT, so sleeping would only make it slower.
process.exitCode = 0;
