// The four volume mountpoints the Kit declares in `kit/t3-code.yaml`. `nuke`
// wipes their contents from inside the sandbox, and the smoke suite reads the
// same list, so the paths live in one place.
//
// These are mountpoints, not volume object names: `sbx` names the objects, and
// the kit only knows where they are mounted. See ADR 0003.
export const VOLUME_PATHS = [
  "/home/agent/workspace",
  "/home/agent/.t3/userdata",
  "/home/agent/.t3/projects",
  "/home/agent/.t3/worktrees",
] as const;
