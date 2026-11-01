# Spike: does `t3 serve` survive inside a sandbox?

Throwaway. Ran 2026-10-30 **inside** an existing sbx sandbox (not on the host),
because `sbx` itself is a host-side CLI and is not available from within a
sandbox. What this proves and what it does not:

| Claim                                                                 | Status                           |
| --------------------------------------------------------------------- | -------------------------------- |
| `t3 serve --host 0.0.0.0` runs headless in a Linux container          | ✅ proven                        |
| It prints pairing details (token, URL, QR) with no browser            | ✅ proven                        |
| `libatomic1`, node, bun, git, gh, pi are enough on a Linux base       | ✅ proven                        |
| sbx publishes a host port into the sandbox and the browser reaches it | ❌ **unproven** — needs the host |
| Kit descriptor validates and builds via the Kit frontend              | ❌ **unproven** — needs the host |
| Proxy-injected secrets work for pi's provider                         | ❌ **unproven**                  |

## Findings

1. **Headless serve works.** `t3 serve --host 0.0.0.0 --port 3774 --no-browser
   --base-dir /tmp/t3spike` migrated 72 migrations, logged
   `Listening on http://0.0.0.0:3774`, then printed:

   ```
   T3 Code server is ready.
   Connection string: http://172.17.0.1:3774
   Token: VCA4FGJ6MMEZ
   Pairing URL: http://172.17.0.1:3774/pair#token=VCA4FGJ6MMEZ
   App link: t3code://pair?pairingUrl=...
   ```

   `curl http://127.0.0.1:3774/` → **200**.

2. ⚠️ **The printed pairing URL carries the outbound interface IP**, not
   `localhost`. Inside sbx that is the VM address, which the host browser
   cannot reach. The launcher must rewrite host:port to
   `http://localhost:<published-port>/pair#token=<token>`. This is the single
   most likely cause of a "the kit looks broken" first run.

3. ⚠️ **`sbx` has no `logs` verb.** t3's stdout is therefore unreachable
   unless the entrypoint mirrors it to a file. `kit/serve.sh` tees to
   `$T3CODE_HOME/serve.log`; `logs` reads that file via `sbx exec`.

4. **Deny-by-default confirmed live.** A request from inside the sandbox to a
   non-loopback address returned HTTP 403 with the body:

   ```
   Approval required for 172.17.0.1:3774.
   Review and respond with: sbx policy approval ls
   ```

   So a blocked destination fails as a **403 from the proxy**, not a
   connection error. Worth putting in the README's troubleshooting section:
   an agent that "cannot reach the API" is usually this.

5. **Install paths.** `t3` installs from `https://t3.codes/install.sh`, which
   honours `T3CODE_VERSION` (pin) and `T3CODE_INSTALL_BIN_DIR`. pi installs
   from npm as `@earendil-works/pi-coding-agent`; `pi -p '<prompt>'` is the
   headless form the smoke test uses.

6. **Useful t3 env vars** (from the 0.1.5 binary): `T3CODE_HOME`,
   `T3CODE_HOST`, `T3CODE_PORT`, `T3CODE_NO_BROWSER`,
   `T3CODE_AUTO_BOOTSTRAP_PROJECT_FROM_CWD`, `T3CODE_DEV_ALLOWED_ORIGINS`.

## What the host-side spike must still answer

Run these on the host before trusting the kit:

```sh
sbx run -d --name spike ./kit          # does the descriptor validate and build?
sbx ports spike --publish 127.0.0.1:3773:3773
curl -i http://localhost:3773/          # 200, or a Host-header rejection?
sbx exec spike -- t3 pair               # does a fresh token mint, and what URL?
```

If `curl` returns 403 **from t3** (not from the proxy), t3 is rejecting the
`Host: localhost:3773` header and the kit needs `T3CODE_DEV_ALLOWED_ORIGINS`
or a different access path.
