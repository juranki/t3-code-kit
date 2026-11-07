# t3-code-kit

A Kit that builds a Docker Sandbox image with T3 Code and pi, so an agent can
run with full permissions inside a microVM that cannot see the host.

## Language

**kit**:
The descriptor, Dockerfile, and policy that `sbx` builds into a sandbox image.
_Avoid_: template, bundle, stack

**skill**:
A directory containing `SKILL.md` that an agent loads on demand.
_Avoid_: plugin, extension, prompt, command

**baked in**:
Present in the image layer, so every sandbox created from that image starts
with it, and a change made inside a running sandbox does not survive a
`rebuild`.
_Avoid_: installed, bundled, preloaded, shipped

**pin**:
A build input fixed to an exact version or commit, so two builds from the same
source produce the same content.
_Avoid_: lock, freeze, snapshot

**rebuild**:
Recreate a sandbox from a freshly built image. The only way baked-in content
changes. Durable state survives it; only `nuke` destroys data.
_Avoid_: restart, refresh, update, recreate

**durable state**:
The contents of a sandbox's volumes: its repos, t3 threads, projects, and
worktrees. Everything else in a sandbox is image or ephemeral state.
_Avoid_: data, files, state (unqualified)

**sandbox instance**:
One created sandbox, identified by name, that `sbx` starts, stops, and removes.
_Avoid_: sandbox (unqualified), container, VM

**volume object**:
The storage `sbx` allocates for a sandbox's volumes, which outlives the
instance that created it.
_Avoid_: disk, mount, volume (unqualified)

**volume contents**:
What lives on a volume object. Destroying contents leaves the object allocated
and empty.
_Avoid_: data, volume

**retention**:
`sbx`'s behaviour of keeping a sandbox's volume objects when the instance is
removed, so that creating the same name with the same kit reattaches them.
_Avoid_: persistence, survival

**nuke**:
Destroy a sandbox's durable state and remove its instance. The only verb that
destroys data.
_Avoid_: delete, purge, destroy, wipe

**browser acceptance**:
Evidence that the kit's baked-in preview browser is in the expected location,
starts with its required libraries and fonts, and renders text and HTTPS pages.
_Avoid_: browser presence check, browser install check
