# Programmatic T3 Code configuration

Research date: **2026-11-07**. Scope: the sandbox kit, its installed T3 executable,
release source, current public upstream, and published npm launcher. No live
settings, credential files, database contents, environment values, or pairing
logs were read; no live configuration was changed. Examples below are proposed
commands, not a record of changes made.

## Findings and version boundaries

T3 has several configuration surfaces, rather than one universal configuration
API. For this kit, use startup flags/environment for process settings, a
version-matched `userdata/settings.json` for server preferences, and checked-in
`t3.json` for its supported repository defaults. Managed policy is an additional
administrator surface in release 0.1.7, but is absent from release 0.1.5. The
UI's typed RPC can update settings while the server runs, but should be treated
as an internal, version-coupled protocol. [paths15] [settings15] [project-file15]
[policy17] [rpc15]

| Evidence                                                         | Observed identity                                                                             | What it establishes                                                                                                                                             |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Installed executable, read-only `t3 --version` and `readlink -f` | `t3 v0.1.5`; `/home/agent/.t3/runtime/versions/0.1.5/t3`                                      | Actual local executable version; not proof of the version of every running server or remote environment                                                         |
| Kit checkout at `8313dd59b4ac8b5668ea5da80d1aa1f4df3d9003`       | `t3Version.default: "0.1.7"`; descriptor still advertises `t3-code@0.1.5`                     | Build intent differs from the local executable; `provides` is not an executable version probe [kit-yaml]                                                        |
| Public release tag `v0.1.5`                                      | `6d450a4284852af137b2f3407fddd89eb76e7644`                                                    | Release source used for installed-version analysis; binary was not independently matched against release checksums [release15]                                  |
| Public release tag `v0.1.7`                                      | `322f6544dfad0a3c8a0c8cbecf2c7f7874b14268`                                                    | Release source corresponding to the kit's default pin [release17]                                                                                               |
| Public upstream HEAD at investigation                            | `4c3a9d58184f20bd76833bd599c3544d2c09e3eb`, committed 2026-11-07; server package says `0.1.7` | Current development source; the same package version string does not make this identical to release 0.1.7 [head-package]                                        |
| Existing local reference checkout `/home/agent/workspace/t3code` | `b50d8a1b15eed3a75e1e0969765e14c6436d80d7`, 2026-11-01; server package says `0.1.6`           | Useful reference, not the installed binary's source identity [reference-package]                                                                                |
| npm registry `t3`                                                | `0.1.5` and `0.1.7` metadata and tarballs inspected; `latest` was `0.1.7`                     | The published package is a launcher for release executables, not a separate configuration SDK; metadata did not supply `gitHead` [npm15] [npm17] [npm-launcher] |

Release and HEAD source were inspected in a temporary checkout outside this
repository. Tags were resolved with `git ls-remote`; the existing reference
checkout was not changed. Unless explicitly marked **HEAD** or **0.1.7**, source
citations below refer to **0.1.5**. This distinction matters particularly for
managed policy and secret-provider references.

## Locations, scopes, and schemas

The base directory defaults to `~/.t3`. `--base-dir` takes precedence over
`T3CODE_HOME`; both choose the base, not the `userdata` subdirectory. A development
server with a dev URL and no explicit base uses `dev` instead of `userdata`.
[home] [startup15] [paths15]

| Surface                           | Location / owner                                                                                     | Scope and schema                                                                                                                                                                                                                                                                                                   |
| --------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Server preferences                | `<base>/userdata/settings.json`                                                                      | One server/environment, shared by its clients. `ServerSettings`, `DEFAULT_SERVER_SETTINGS`, `ServerSettingsPatch` in contracts; the persisted decoder accepts sparse settings and fills defaults. No standalone published server-settings JSON Schema was established. [paths15] [settings15] [settings-service15] |
| Project overrides                 | `projectSettingsOverrides[projectId]` in server settings                                             | A schema-selected subset of server preferences; provider project overrides only change `enabled`. Not every server key is project-scoped. [project-overrides15]                                                                                                                                                    |
| Project registration and threads  | `<base>/userdata/statev2.sqlite`                                                                     | Application state, accessed through project/thread operations; not a supported settings-file editing interface. [paths15] [project-contract15]                                                                                                                                                                     |
| Repository defaults               | `<workspace-root>/t3.json`                                                                           | Shared checked-in defaults, restricted to the fields in `T3ProjectFile`; `$schema` points to `https://t3.codes/schema/t3.json`. [project-file15]                                                                                                                                                                   |
| Keyboard shortcuts                | `<base>/userdata/keybindings.json`                                                                   | Separate server-managed file, not `ClientSettings`. [paths15] [keybindings]                                                                                                                                                                                                                                        |
| Environment themes                | `<base>/userdata/themes/*.json`, plus default theme in server settings                               | CLI can publish/set a theme and notify clients. [appearance] [theme15]                                                                                                                                                                                                                                             |
| Web UI preferences                | Browser-origin local storage, key `t3code:client-settings:v1`                                        | `ClientSettingsSchema`; browser profile/origin owned, not automatically set by editing the sandbox's server settings. [client-storage15] [local-api]                                                                                                                                                               |
| Desktop preferences               | Desktop state directory's `client-settings.json`, `desktop-settings.json`, `saved-environments.json` | Separate desktop client/application/environment registries. The web app selects the desktop persistence bridge when present. These are not additional files to seed in a headless sandbox. [desktop-paths] [local-api]                                                                                             |
| Background-service environment    | `<base>/service.env`                                                                                 | Supported service-launcher file; literal `KEY=VALUE`, restart required. It is not documented as input to a directly invoked `t3 serve`. [service]                                                                                                                                                                  |
| Machine managed policy, **0.1.7** | Linux `/etc/t3code/policy.json`; OS equivalents below                                                | Administrator defaults, locks, limits; separate `ManagedPolicyDocument` schema. Restart required. [policy17] [policy-schema17]                                                                                                                                                                                     |

The schema endpoint itself returned HTTP 403 from this research environment;
its URL and fields are confirmed by release source, not by a successful fetch
of the deployed schema. Do not assume that a future schema at that unversioned
URL matches the installed binary. [project-file15]

Examples of environment settings include `defaultRuntimeMode`,
`defaultModelSelection`, `defaultThreadEnvMode`, `defaultAutoPull`,
`enableAgentBrowserAccess`, `worktreesDirectory`, `storageCleanup`,
`branchNamePrefix`, `textGenerationModelSelection`, and `providerInstances`.
Use the **encoded** schema: duration settings such as
`providerHealthRefreshInterval` encode as milliseconds. `ModelSelection` uses
`instanceId`, `model`, and `options`, rather than an invented provider/model
string. [settings15] [model-selection15]

The documented inheritance order for file-backed settings is **project override
→ environment setting → `t3.json` → built-in**. `null` allows environment
inheritance for `defaultThreadEnvMode` and `worktreeSubmodules`; it is not a
universal reset operator. An “All environments” UI edit is a bulk edit of
connected servers, not a synchronized global default; offline machines keep
their values. [project-doc] [project-file15] [project-overrides15]

Repository `t3.json` supports `iconPath`, `defaultThreadEnvMode`
(`local`/`worktree`), `worktreeSubmodules` (`recursive`/`top-level`/`none`), and
`scripts` (up to 50), including lifecycle flags. Scripts can be imported into
saved project actions; do not assume that modifying the file overwrites an
already saved actions list. The loader reads the file when called and treats
missing/invalid files as absent, with warnings for invalid content. It does
not itself establish a continuously watched repository-settings service.
[project-file15] [project-doc] [project-loader]

**HEAD internal additional file:** VCS resolution searches the current directory
and ancestors for `.t3code/vcs.json`, accepting `vcs.kind` or legacy `vcsKind`.
This is separate from `t3.json`, and should not be generalized into a universal
`.t3code/config.json` convention. Compatibility with the installed release was
not established here. [vcs-head]

## CLI flags and startup environment

Read-only installed `t3 --help` and `t3 serve --help` confirmed these flags:

| Flag                                          | Environment counterpart in 0.1.5 source                 | Purpose                                         |
| --------------------------------------------- | ------------------------------------------------------- | ----------------------------------------------- |
| `--base-dir`                                  | `T3CODE_HOME`                                           | Data base directory                             |
| `--mode`                                      | `T3CODE_MODE`                                           | `web` or `desktop`                              |
| `--host`, `--port`                            | `T3CODE_HOST`, `T3CODE_PORT`                            | HTTP/WebSocket listener                         |
| `--no-browser`                                | `T3CODE_NO_BROWSER`                                     | Suppress browser opening                        |
| `--dev-url`                                   | `VITE_DEV_SERVER_URL`                                   | Development web frontend                        |
| `--bootstrap-fd`                              | `T3CODE_BOOTSTRAP_FD`                                   | One-time bootstrap envelope via file descriptor |
| `--auto-bootstrap-project-from-cwd`           | `T3CODE_AUTO_BOOTSTRAP_PROJECT_FROM_CWD`                | Register startup working directory              |
| `--log-websocket-events` / `--log-ws-events`  | `T3CODE_LOG_WS_EVENTS`                                  | Push-traffic diagnostics                        |
| `--tailscale-serve`, `--tailscale-serve-port` | `T3CODE_TAILSCALE_SERVE`, `T3CODE_TAILSCALE_SERVE_PORT` | Tailscale startup integration                   |
| Global `--log-level`                          | `T3CODE_LOG_LEVEL`                                      | Log threshold                                   |

These mappings and precedence are implemented in the CLI config resolver.
Flags normally beat environment, then bootstrap input where applicable, then
defaults. `serve` headless mode forces no-browser and disables automatic project
bootstrap before the ordinary flag/environment fallback. A positional `cwd`
selects provider-session working directory. **HEAD** also has `--lan` /
`T3CODE_LAN`; the installed 0.1.5 help did not list `--lan`, so gate its use on
the actual executable's help. [startup15] [startup-head]

Other startup inputs include `T3CODE_TRACE_FILE`, `T3CODE_TRACE_MIN_LEVEL`,
`T3CODE_TRACE_TIMING_ENABLED`, `T3CODE_TRACE_MAX_BYTES`,
`T3CODE_TRACE_MAX_FILES`, `T3CODE_TRACE_BATCH_WINDOW_MS`; OTLP traces/metrics/logs
URLs and export headers/protocol/interval; and development allowed origins and
a redacted development auth token. These are explicit named inputs, not evidence
for a generic `T3CODE_<SETTING>` mapping. Listener/environment changes require
restarting the process; changing shell exports cannot change an existing
process's environment. [startup15]

The installed top-level help has `project`, `thread`, `theme`, `auth`, and
`service` commands, but no generic `config get/set`. `project` lists add, remove,
and rename; no generic `project update` CLI was confirmed. Use `--help` from the
target executable rather than inventing commands from UI concepts. [project-cli15]
[theme15]

For service-managed installs, official docs specify `service.env` values are
literal, not shell expansion, and override inherited service environment except
reserved names including `PATH` and `T3CODE_HOME`. Run `t3 service restart` to
apply them. The kit instead runs `/home/agent/serve.sh` through the sandbox
lifecycle hook; `service.env` should not be used as its configuration mechanism.
[service] [kit-yaml] [kit-serve]

## Live settings, provider operations, RPC, and MCP

**Confirmed implementation, internal protocol:** contracts define
`server.getConfig` and `server.updateSettings`. The update payload is
`{ patch: ServerSettingsPatch, providerInstanceMutation?: ProviderInstanceMutation }`
and returns `ServerSettings`. `server.getConfig` returns the broader
`ServerConfig` snapshot. Current server source serves Effect RPC with JSON
serialization at `/ws`; it is not evidence for an HTTP `PATCH /settings`
endpoint or a JSON-RPC 2.0 request format. Use the matching T3 client transport
and contracts if integrating at this layer. [ws-transport-head]
No independently supported external
settings SDK or compatibility promise was found in the reviewed sources.
[rpc15] [ws-head]

The update is not a generic recursive JSON merge. In 0.1.5,
`patch.providerInstances` replaces the whole map. Prefer the explicit
`providerInstanceMutation` (`create`/`upsert`/`remove`) when changing one instance.
Project override patches replace each included project's override set; a `null`
entry removes it, with a special preservation rule for omitted provider
instance overrides. Preserve unrelated fields; do not blindly replay a redacted
snapshot as a complete desired state. [patch15] [provider-instance15]

Authentication/authorization applies: settings changes require `settings:write`,
provider-map changes require `providers:manage`; mixed patches may require both.
Provider contracts also expose setup validation, refresh, authentication start/
respond/complete/cancel/logout/subscription, and installation operations. These
are application APIs, not shell equivalents to storing an API key. Do not
bypass the auth control plane or scrape credentials from server runtime files
to call them. [scopes15] [rpc15] [rpc-head]

**MCP has narrower controls:** `t3_project_update` accepts `ProjectUpdatePayload`
(title, workspace root, default model, auto-pull, icon, default workspace mode,
scripts, etc.). `t3_thread_configure` changes a thread's model selection/options;
`orchestrator_capabilities` discovers supported choices. These are scoped
operations, not a universal server-settings setter. A generic settings-write
MCP tool was not found in the reviewed toolkit registrations. Tool exposure can
vary with installed build, permissions, and orchestration context; inspect the
available schema before use. [mcp-project15] [project-contract15] [mcp-thread]
[mcp-capabilities]

## Providers and secrets

Each `providerInstances[id]` envelope has `driver`, optional `displayName`,
`accentColor`, `enabled`, `environment`, and driver-specific `config`. Environment
entries in 0.1.5 use `{ name, value, sensitive, valueRedacted? }`; driver config is
validated by its own implementation, not by the envelope's `Schema.Unknown`.
Pi's schema includes `binaryPath`, `launchArgs`, and custom models. Codex's
schema includes binary/config-home paths and launch arguments. Extra provider
launch arguments are constrained by the driver; they cannot freely replace
T3-owned process/session flags. [provider-instance15] [pi-settings] [settings15]
[pi-doc]

T3 preferences and provider-native configuration are distinct. Official Pi docs
say T3 reuses Pi's native auth, models, extensions, skills, and session history.
The kit owns Codex's generated `config.toml`/`auth.json` and rewrites them at
startup according to `SBX_CRED_OPENAI_MODE`; editing them manually is not durable
kit configuration. The kit uses proxy-managed credential sentinels, with real
credentials substituted outside the sandbox. Keep that route rather than
copying host secrets into settings or images. [pi-doc] [kit-serve] [kit-yaml]

T3's 0.1.5 settings service migrates recognized inline secret fields into
`ServerSecretStore` and uses redaction markers; client responses redact sensitive
settings. The store is filesystem-backed under `userdata/secrets`, using a 0700
directory and 0600 files with atomic replacement. It is **not** evidence of an
encrypted OS keychain. A non-sensitive environment value may remain readable in
settings. Do not write actual secrets into examples, policy, source control,
startup logs, or a full settings dump. [settings-service15] [redaction15] [secret-store]

**HEAD newer capability:** provider environment schemas accept secret references
alongside an empty encoded value. Official docs describe 1Password-backed
references and `request_secret` cards; they explicitly say the Secrets settings
page is preview-only and not in every build. Release 0.1.5's environment schema
only accepts strings, so those references must not be seeded into that build.
A `secretRef` returned by an agent secret request and a persistent
provider-settings secret reference are different contracts. [provider-instance15]
[provider-instance-head] [secrets-head]

## Persistence and when changes take effect

- **Ordinary settings file:** the 0.1.5 service writes sparse JSON atomically,
  watches the settings directory and symlink target directories, debounces
  events by 100 ms, revalidates, and publishes changes. API writes are serialized
  and reload current disk state before applying a patch. This supports live
  file changes, but does not make external read/modify/write atomic with an API
  writer. [settings-service15]
- **Invalid settings:** 0.1.5 logs a parse warning and uses defaults, with
  `continueThreadsAfterServerUpdate` forced false. API writes reject an existing
  parse failure. Invalid input is not safely ignored while retaining every last
  good setting; validate and use atomic writes. [settings-service15]
- **Client propagation:** current RPC subscriptions forward redacted settings
  changes. Current provider hydration reconciles changed provider instances;
  secret refresh can rebuild an instance when credentials changed. That is not
  a guarantee that every active agent process adopts every setting immediately.
  Official docs specifically defer browser-access changes to the next session
  start, and allow a running turn to finish after a project provider is disabled.
  [ws-head] [hydration-head] [registry-head] [project-doc]
- **Startup configuration and managed policy:** restart the server. Reconnecting
  a browser does not reload machine policy. OTLP startup resolution is another
  reason not to assume every JSON preference is immediately effective.
  [startup15] [policy17]
- **Repository settings:** take effect at the relevant file load/new thread or
  worktree resolution/import. No blanket live-reload guarantee was established.
  [project-loader] [project-doc]
- **Theme CLI:** `theme set` switches connected web/desktop clients; offline
  clients apply it on reconnect, once per set operation. Clients can choose
  another theme afterward. `theme clear` does not reset current client themes.
  Mobile has its own appearance settings. [appearance]

## Managed policy: supported in 0.1.7, absent in installed 0.1.5

The 0.1.7 release includes `t3 policy check <file>`, `show`, and `templates`.
Its machine policy has required `schemaVersion: 1` and `organization`, optional
`supportUrl`, `settings` keyed by encoded server-setting dot paths, and `limits`.
`locked: false` supplies defaults; `locked: true` enforces values without
rewriting the user's stored preferences. Limits include allowed drivers,
provider launch fields/environment, maximum permission mode, clients, Connect,
telemetry, webhook tasks, browser-cookie import, and updates. [policy17]
[policy-schema17] [policy-cli17]

OS sources are `/etc/t3code/policy.json` on Linux; a machine profile for
`com.t3tools.t3code` or `/Library/Application Support/T3Code/policy.json` on macOS;
and `HKLM\SOFTWARE\Policies\T3Tools\T3Code` or
`C:\Program Files\T3Code\policy.json` on Windows. Native and file policies are
not merged; conflicts, unknown keys, and invalid values fail startup. Policy
changes require restart, and policy files must not contain credentials.
[policy17]

This is promising for kit-owned defaults and locks after verifying 0.1.7 on the
actual sandbox. It cannot enforce a sandbox security boundary against a user
who replaces T3 or changes provider-native configuration. In particular, a
policy that disallows `remote` conflicts with this kit's explicit `0.0.0.0`
listener and forwarded browser access. Treat that choice as a deployment design,
not a generic hardening default. [policy17] [kit-serve]

## Runnable examples, with bounded effects

These examples use supported CLI/file paths and contain no real credentials.
Only the read-only help/version commands were executed during research. The
isolated-server example and policy example were not run. They are not live
configuration changes to apply silently.

### Identify the target executable without dumping settings

```sh
t3 --version
t3 serve --help
t3 project --help
t3 theme set --help
```

### Start an isolated server with a small non-secret settings seed

This creates a new disposable base and binds loopback on a different port. Stop
with Ctrl-C; remove the printed temporary directory manually when finished.
The server may print pairing credentials: do not publish its output.
The `pi` binary must already exist for its provider to work. [startup15]
[settings15] [provider-instance15] [pi-settings]

```sh
config_probe_dir=$(mktemp -d)
mkdir -p "$config_probe_dir/userdata"
cat > "$config_probe_dir/userdata/settings.json" <<'JSON'
{
  "enableProviderUpdateChecks": false,
  "defaultThreadEnvMode": "worktree",
  "providerInstances": {
    "pi": {
      "driver": "pi",
      "enabled": true,
      "config": { "binaryPath": "pi", "launchArgs": "" }
    }
  }
}
JSON
printf 'Disposable T3 base: %s\n' "$config_probe_dir"
t3 serve --base-dir "$config_probe_dir" --host 127.0.0.1 --port 4773 --no-browser
```

Equivalent startup location/listener inputs can be supplied with
`T3CODE_HOME="$config_probe_dir" T3CODE_HOST=127.0.0.1 T3CODE_PORT=4773 t3 serve`.
Do not set `T3CODE_HOME` to `.../userdata`, which would nest state incorrectly.
[startup15] [paths15]

### Produce a repository-default draft without editing a project

```sh
project_config_draft=$(mktemp -d)
cat > "$project_config_draft/t3.json" <<'JSON'
{
  "$schema": "https://t3.codes/schema/t3.json",
  "defaultThreadEnvMode": "worktree",
  "worktreeSubmodules": "recursive",
  "scripts": [{ "name": "Check", "command": "npm run check" }]
}
JSON
printf 'Review, then copy into the intended repository: %s/t3.json\n' "$project_config_draft"
```

This sets only supported repository fields. An explicit environment/project
setting can override the workspace/submodule choices; scripts remain subject to
the project's import/override behavior. [project-file15] [project-doc]

### Validate a policy draft on a verified 0.1.7 executable

First inspect `t3 --version` and `t3 policy --help` on the target. Do not use the
installed 0.1.5 binary for this. Validation of a draft does not deploy it.
[policy-cli17]

```sh
policy_draft_dir=$(mktemp -d)
cat > "$policy_draft_dir/policy.json" <<'JSON'
{
  "schemaVersion": 1,
  "organization": "T3 sandbox kit",
  "settings": {
    "defaultThreadEnvMode": { "value": "worktree", "locked": false }
  },
  "limits": { "updates": { "mode": "off" } }
}
JSON
t3 policy check "$policy_draft_dir/policy.json"
```

Deploying it to `/etc/t3code/policy.json` and restarting is a separate operation,
not performed here. `limits.updates.mode: "off"` covers T3's update flow; the
ordinary `enableProviderUpdateChecks: false` setting above covers provider
update checks, a different feature. [policy17] [settings15]

For an intentional live theme change, the supported CLI is
`t3 theme set --base-dir /path/to/t3-base <theme-id>`; project registration is
`t3 project add --base-dir /path/to/t3-base --title 'Example' /path/to/repo`.
These mutate state, so they were only checked through help/source here.
[theme15] [project-cli15]

For a UI-integrated settings writer, the **internal RPC payload shape** for one
provider is below. This is not a standalone `curl` recipe: transport framing,
authentication, scopes, and version-matched contracts are prerequisites.
[rpc15] [provider-instance15] [scopes15]

```json
{
  "patch": {},
  "providerInstanceMutation": {
    "operation": "upsert",
    "instanceId": "pi",
    "instance": {
      "driver": "pi",
      "enabled": true,
      "config": { "binaryPath": "pi", "launchArgs": "" }
    }
  }
}
```

## Recommended integration for this kit

1. **Verify the actual target version first.** Align descriptor default,
   Dockerfile `T3_VERSION`, executable version, and acceptance checks. This
   research found an installed/default mismatch and stale `provides` metadata;
   it did not change either. Pin schemas/examples to the shipped release SHA,
   not upstream HEAD or npm `latest`. [kit-yaml] [kit-dockerfile]
2. **Use the existing process owner.** Put startup decisions in `kit/serve.sh`
   and explicitly pass any new environment names through the lifecycle hook in
   `kit/t3-code.yaml`. That hook intentionally forwards a limited environment.
   Keep listener port, declared container port, and host port mapping aligned.
   The current script already passes explicit host/port/no-browser flags, so
   a lower-precedence startup preference cannot override them. [kit-serve]
   [kit-yaml]
3. **For ordinary user-adjustable preferences, seed once before `t3 serve`.**
   A future implementation can create a sparse, version-validated
   `userdata/settings.json` only when absent. Do not replace a populated file
   on every startup. The volume retains it across rebuilds; baking defaults
   solely under an eventual volume mount is insufficient for existing state.
   Distinguish a one-time seed from an explicit operator-requested migration.
   [settings-service15] [kit-yaml] [durability]
4. **For defaults/locks the kit must own, evaluate 0.1.7 managed policy.** Bake
   a checked policy at `/etc/t3code/policy.json`, validate against the shipped
   executable, and rebuild/restart to apply it. This keeps policy separate
   from durable user preferences. Decide deliberately whether the kit should
   manage users at all; do not deploy policy merely to prefill one preference.
   It is unavailable on the locally installed 0.1.5. [policy17] [policy-cli17]
5. **Use `t3.json` for repository choices, scoped MCP/CLI for project/thread
   operations.** Avoid direct SQLite edits. For live arbitrary server settings,
   choose either an explicitly supported file-edit workflow with atomic writes
   and writer coordination, or a maintained version-matched internal RPC client.
   The latter costs protocol/auth maintenance; no generic configuration MCP
   shortcut was confirmed. [project-file15] [settings-service15] [rpc15]
   [mcp-project15]
6. **Keep secrets on the kit's existing credential path.** Provider selection,
   credential service name, injected env name, proxy domain/header, and runtime
   egress must agree. Codex's auth/config files are regenerated each startup;
   `userdata` secrets survive rebuild, while `.codex` is not a declared volume.
   Do not add actual keys to policy, defaults, or image layers. [kit-yaml]
   [kit-serve]
7. **Do not mount the entire T3 base as durable state.** The executable symlink
   targets `<base>/runtime/versions/...`, and a volume would shadow the baked
   runtime. Keep the existing workspace/userdata/projects/worktrees split.
   Changing `T3CODE_HOME` or `worktreesDirectory` without adjusting volumes can
   move state out of durable storage. `rebuild` retains durable state; `nuke`
   deliberately wipes it. [kit-yaml] [paths15] [durability]
8. **Leave client preferences to clients unless a documented mechanism exists.**
   Server defaults cannot generally rewrite browser local storage. Theme CLI is
   one documented exception for communicating an environment default. Avoid
   making local-storage key manipulation a supported kit API. [client-storage15]
   [local-api] [appearance]

## Remaining limits and verification needs

This is source research, not a mutation test against the live server. The exact
running server version, build flags, and available authenticated settings RPC
were not probed; no active session was restarted. A package version alone does
not prove binary/source identity. The 0.1.5 and 0.1.7 npm packages are launchers,
so inspecting npm is not a substitute for checking the executable they launch.
[npm-launcher]

Before implementation, test a disposable base with the chosen release: sparse
settings decoding, an atomic live update, preservation of unrelated overrides,
provider enable/discovery, policy validation/restart behavior if selected, and
rebuild persistence under the actual sandbox runtime. Do not use live auth files
or ongoing threads as test fixtures. There is no established guarantee here
that every setting is supported in every desktop/mobile preview build or that
all preferences reload without restarting provider sessions.

## Report verification

Citation targets and line bounds were checked against the fetched Git objects;
JSON examples parse and shell examples pass `sh -n`. The initial `npm run check`
failed because workspace dependencies were absent. After `npm ci` and formatting
this report, `npm run check` passed: formatting, lint with zero warnings,
typecheck, and all 181 tests across 12 files. Only this report was added to the
shared checkout.

## Primary sources

Links are pinned to full commit IDs where practical. Local kit links resolve
from this research file; upstream documentation is first-party source shipped
in the repository. npm metadata/tarballs and schema URLs are separately named
because they are published endpoints rather than commit-pinned source.

[release15]: https://github.com/pingdotgg/t3code/tree/6d450a4284852af137b2f3407fddd89eb76e7644
[release17]: https://github.com/pingdotgg/t3code/tree/322f6544dfad0a3c8a0c8cbecf2c7f7874b14268
[head-package]: https://github.com/pingdotgg/t3code/blob/4c3a9d58184f20bd76833bd599c3544d2c09e3eb/apps/server/package.json#L1-L15
[reference-package]: https://github.com/pingdotgg/t3code/blob/b50d8a1b15eed3a75e1e0969765e14c6436d80d7/apps/server/package.json#L1-L15
[npm15]: https://registry.npmjs.org/t3/0.1.5
[npm17]: https://registry.npmjs.org/t3/0.1.7
[npm-launcher]: https://github.com/pingdotgg/t3code/blob/6d450a4284852af137b2f3407fddd89eb76e7644/scripts/npm-launcher/t3.mjs#L14-L100
[home]: https://github.com/pingdotgg/t3code/blob/4c3a9d58184f20bd76833bd599c3544d2c09e3eb/apps/server/src/os-jank.ts#L123-L129
[paths15]: https://github.com/pingdotgg/t3code/blob/6d450a4284852af137b2f3407fddd89eb76e7644/apps/server/src/config.ts#L138-L172
[startup15]: https://github.com/pingdotgg/t3code/blob/6d450a4284852af137b2f3407fddd89eb76e7644/apps/server/src/cli/config.ts#L30-L510
[startup-head]: https://github.com/pingdotgg/t3code/blob/4c3a9d58184f20bd76833bd599c3544d2c09e3eb/apps/server/src/cli/config.ts#L88-L175
[settings15]: https://github.com/pingdotgg/t3code/blob/6d450a4284852af137b2f3407fddd89eb76e7644/packages/contracts/src/settings.ts#L1148-L1329
[project-overrides15]: https://github.com/pingdotgg/t3code/blob/6d450a4284852af137b2f3407fddd89eb76e7644/packages/contracts/src/settings.ts#L999-L1067
[settings-service15]: https://github.com/pingdotgg/t3code/blob/6d450a4284852af137b2f3407fddd89eb76e7644/apps/server/src/serverSettings.ts#L556-L1169
[patch15]: https://github.com/pingdotgg/t3code/blob/6d450a4284852af137b2f3407fddd89eb76e7644/packages/shared/src/serverSettings.ts#L229-L545
[scopes15]: https://github.com/pingdotgg/t3code/blob/6d450a4284852af137b2f3407fddd89eb76e7644/packages/contracts/src/settings.ts#L1639-L1679
[project-file15]: https://github.com/pingdotgg/t3code/blob/6d450a4284852af137b2f3407fddd89eb76e7644/packages/contracts/src/t3ProjectFile.ts#L8-L134
[project-doc]: https://github.com/pingdotgg/t3code/blob/4c3a9d58184f20bd76833bd599c3544d2c09e3eb/docs/user/project-settings.md
[project-loader]: https://github.com/pingdotgg/t3code/blob/4c3a9d58184f20bd76833bd599c3544d2c09e3eb/apps/server/src/project/T3ProjectFileLoader.ts#L28-L93
[vcs-head]: https://github.com/pingdotgg/t3code/blob/4c3a9d58184f20bd76833bd599c3544d2c09e3eb/apps/server/src/vcs/VcsProjectConfig.ts#L13-L102
[project-contract15]: https://github.com/pingdotgg/t3code/blob/6d450a4284852af137b2f3407fddd89eb76e7644/packages/contracts/src/project.ts#L169-L220
[project-cli15]: https://github.com/pingdotgg/t3code/blob/6d450a4284852af137b2f3407fddd89eb76e7644/apps/server/src/cli/project.ts
[theme15]: https://github.com/pingdotgg/t3code/blob/6d450a4284852af137b2f3407fddd89eb76e7644/apps/server/src/cli/theme.ts
[appearance]: https://github.com/pingdotgg/t3code/blob/4c3a9d58184f20bd76833bd599c3544d2c09e3eb/docs/user/appearance.md#L57-L108
[keybindings]: https://github.com/pingdotgg/t3code/blob/4c3a9d58184f20bd76833bd599c3544d2c09e3eb/docs/user/keybindings.md
[client-storage15]: https://github.com/pingdotgg/t3code/blob/6d450a4284852af137b2f3407fddd89eb76e7644/apps/web/src/clientPersistenceStorage.ts#L1-L25
[local-api]: https://github.com/pingdotgg/t3code/blob/4c3a9d58184f20bd76833bd599c3544d2c09e3eb/apps/web/src/localApi.ts#L60-L72
[desktop-paths]: https://github.com/pingdotgg/t3code/blob/4c3a9d58184f20bd76833bd599c3544d2c09e3eb/apps/desktop/src/app/DesktopEnvironment.ts#L175-L205
[service]: https://github.com/pingdotgg/t3code/blob/4c3a9d58184f20bd76833bd599c3544d2c09e3eb/docs/user/background-service.md#L69-L91
[rpc15]: https://github.com/pingdotgg/t3code/blob/6d450a4284852af137b2f3407fddd89eb76e7644/packages/contracts/src/rpc.ts#L623-L810
[rpc-head]: https://github.com/pingdotgg/t3code/blob/4c3a9d58184f20bd76833bd599c3544d2c09e3eb/packages/contracts/src/rpc.ts#L495-L840
[ws-head]: https://github.com/pingdotgg/t3code/blob/4c3a9d58184f20bd76833bd599c3544d2c09e3eb/apps/server/src/ws.ts#L2685-L2698
[mcp-project15]: https://github.com/pingdotgg/t3code/blob/6d450a4284852af137b2f3407fddd89eb76e7644/apps/server/src/mcp/toolkits/project/tools.ts#L88-L99
[mcp-thread]: https://github.com/pingdotgg/t3code/blob/4c3a9d58184f20bd76833bd599c3544d2c09e3eb/apps/server/src/mcp/toolkits/thread/tools.ts#L153-L180
[mcp-capabilities]: https://github.com/pingdotgg/t3code/blob/4c3a9d58184f20bd76833bd599c3544d2c09e3eb/apps/server/src/mcp/toolkits/orchestrator/tools.ts#L70-L90
[provider-instance15]: https://github.com/pingdotgg/t3code/blob/6d450a4284852af137b2f3407fddd89eb76e7644/packages/contracts/src/providerInstance.ts#L29-L75
[pi-settings]: https://github.com/pingdotgg/t3code/blob/6d450a4284852af137b2f3407fddd89eb76e7644/packages/provider-pi/src/settings.ts#L11-L41
[pi-doc]: https://github.com/pingdotgg/t3code/blob/4c3a9d58184f20bd76833bd599c3544d2c09e3eb/docs/user/providers-pi.md
[secret-store]: https://github.com/pingdotgg/t3code/blob/6d450a4284852af137b2f3407fddd89eb76e7644/apps/server/src/auth/ServerSecretStore.ts#L154-L209
[provider-instance-head]: https://github.com/pingdotgg/t3code/blob/4c3a9d58184f20bd76833bd599c3544d2c09e3eb/packages/contracts/src/providerInstance.ts#L32-L67
[secrets-head]: https://github.com/pingdotgg/t3code/blob/4c3a9d58184f20bd76833bd599c3544d2c09e3eb/docs/user/secrets.md
[hydration-head]: https://github.com/pingdotgg/t3code/blob/4c3a9d58184f20bd76833bd599c3544d2c09e3eb/apps/server/src/provider/ProviderInstanceRegistryHydration.ts#L123-L190
[registry-head]: https://github.com/pingdotgg/t3code/blob/4c3a9d58184f20bd76833bd599c3544d2c09e3eb/apps/server/src/provider/ProviderInstanceRegistry.ts#L496-L540
[policy17]: https://github.com/pingdotgg/t3code/blob/322f6544dfad0a3c8a0c8cbecf2c7f7874b14268/docs/user/managed-policy.md
[policy-schema17]: https://github.com/pingdotgg/t3code/blob/322f6544dfad0a3c8a0c8cbecf2c7f7874b14268/packages/contracts/src/managedPolicy.ts#L8-L100
[policy-cli17]: https://github.com/pingdotgg/t3code/blob/322f6544dfad0a3c8a0c8cbecf2c7f7874b14268/apps/server/src/cli/policy.ts#L72-L118
[kit-yaml]: ../../kit/t3-code.yaml
[kit-serve]: ../../kit/serve.sh
[kit-dockerfile]: ../../kit/t3-code.dockerfile
[durability]: ../adr/0003-durability-model.md
[model-selection15]: https://github.com/pingdotgg/t3code/blob/6d450a4284852af137b2f3407fddd89eb76e7644/packages/contracts/src/modelSelection.ts#L1-L51
[redaction15]: https://github.com/pingdotgg/t3code/blob/6d450a4284852af137b2f3407fddd89eb76e7644/apps/server/src/serverSettings.ts#L131-L138
[ws-transport-head]: https://github.com/pingdotgg/t3code/blob/4c3a9d58184f20bd76833bd599c3544d2c09e3eb/apps/server/src/ws.ts#L3505-L3578
