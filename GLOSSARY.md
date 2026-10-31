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
changes.
_Avoid_: restart, refresh, update, recreate
