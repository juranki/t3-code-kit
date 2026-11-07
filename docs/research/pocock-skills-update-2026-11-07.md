# Pocock skills update assessment — 2026-11-07

## Recommendation

Bump the image's skills source pin to `4ae2317ddb22b046e26455e4f9c9b3aaaf62212d` in a subsequent implementation change; keep the existing 27 selected skills. Add none, remove none, rename none. Do not add the new beta `software-factory` by default: it is a design vocabulary with lifecycle assumptions that conflict with this kit's durable state. Keep it as an optional future evaluation when the user explicitly wants to design a remote software factory. Review the expanded `chief-of-staff` behavior before using it for a long-running goal. This report changes no image, selection, configuration, issue, or running sandbox.

## Source boundary and method

The official repository was cloned into `/tmp/pocock-skills-research-20261107`; `repos/` was untouched. The default branch resolves to `main`. Both the clone's HEAD and a separate `git ls-remote origin HEAD` returned the target below. “Latest” means the default-branch source observed on 2026-11-07, not an unmerged feature branch or a new published version.

| Input                | Exact identity                             | Commit date (UTC)   |
| -------------------- | ------------------------------------------ | ------------------- |
| Repository pin       | `a496f5513d4a4cf889bc48e189e579f4b0bdf6aa` | 2026-10-29 10:42:51 |
| Latest upstream main | `4ae2317ddb22b046e26455e4f9c9b3aaaf62212d` | 2026-10-31 14:23:30 |

Author and committer timestamps agree for both endpoints. The target is only two commits ahead: [chief-of-staff changes, 2026-10-31 13:47:43 UTC][chief-commit], then [software-factory addition][latest]. Both changes have pending patch changesets; upstream `package.json` and plugin metadata still say **1.3.2** and are unchanged. The kit's **1.7.6** is the independent `skills` installer version, not the upstream skills collection version. No installer bump is justified by this delta. [package] [plugin] [chief-changeset] [factory-changeset] [docker]

I compared recursive Git trees at both commits, all file changes including supporting files, every `SKILL.md` path, and the 27-name local manifest. The complete diff is **10 files, 535 insertions, 1 deletion**. There are no deleted files, moved files, renamed skills, or modified stable engineering/productivity instructions. The existing 26 selected skill directories other than `chief-of-staff` are byte-for-byte unchanged, including their supporting files and Codex metadata. [compare]

## Complete inventory and selection decision

The full source inventory grows from **38 to 39** skills: engineering 20 → 20, productivity 7 → 7, in-progress 7 → 8, misc 4 → 4. Deprecated contains no skills at either endpoint. The selected 27 consist of 20 engineering, 6 productivity and the beta `chief-of-staff`; all 27 still exist under the same names. The following table links every latest skill's actual instructions, rather than relying on the README's advertised subset. Compare against the [pinned tree][base-tree] and [latest tree][latest-tree].

| Skill                                                                                                                                                                         | Upstream bucket | Delta     | Selection recommendation |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- | --------- | ------------------------ |
| [ask-matt](https://github.com/mattpocock/skills/blob/4ae2317ddb22b046e26455e4f9c9b3aaaf62212d/skills/engineering/ask-matt/SKILL.md)                                           | engineering     | Unchanged | Keep                     |
| [code-review](https://github.com/mattpocock/skills/blob/4ae2317ddb22b046e26455e4f9c9b3aaaf62212d/skills/engineering/code-review/SKILL.md)                                     | engineering     | Unchanged | Keep                     |
| [codebase-design](https://github.com/mattpocock/skills/blob/4ae2317ddb22b046e26455e4f9c9b3aaaf62212d/skills/engineering/codebase-design/SKILL.md)                             | engineering     | Unchanged | Keep                     |
| [diagnosing-bugs](https://github.com/mattpocock/skills/blob/4ae2317ddb22b046e26455e4f9c9b3aaaf62212d/skills/engineering/diagnosing-bugs/SKILL.md)                             | engineering     | Unchanged | Keep                     |
| [domain-modeling](https://github.com/mattpocock/skills/blob/4ae2317ddb22b046e26455e4f9c9b3aaaf62212d/skills/engineering/domain-modeling/SKILL.md)                             | engineering     | Unchanged | Keep                     |
| [grill-with-docs](https://github.com/mattpocock/skills/blob/4ae2317ddb22b046e26455e4f9c9b3aaaf62212d/skills/engineering/grill-with-docs/SKILL.md)                             | engineering     | Unchanged | Keep                     |
| [implement-spec](https://github.com/mattpocock/skills/blob/4ae2317ddb22b046e26455e4f9c9b3aaaf62212d/skills/engineering/implement-spec/SKILL.md)                               | engineering     | Unchanged | Keep                     |
| [implement](https://github.com/mattpocock/skills/blob/4ae2317ddb22b046e26455e4f9c9b3aaaf62212d/skills/engineering/implement/SKILL.md)                                         | engineering     | Unchanged | Keep                     |
| [improve-codebase-architecture](https://github.com/mattpocock/skills/blob/4ae2317ddb22b046e26455e4f9c9b3aaaf62212d/skills/engineering/improve-codebase-architecture/SKILL.md) | engineering     | Unchanged | Keep                     |
| [pr](https://github.com/mattpocock/skills/blob/4ae2317ddb22b046e26455e4f9c9b3aaaf62212d/skills/engineering/pr/SKILL.md)                                                       | engineering     | Unchanged | Keep                     |
| [prototype](https://github.com/mattpocock/skills/blob/4ae2317ddb22b046e26455e4f9c9b3aaaf62212d/skills/engineering/prototype/SKILL.md)                                         | engineering     | Unchanged | Keep                     |
| [research](https://github.com/mattpocock/skills/blob/4ae2317ddb22b046e26455e4f9c9b3aaaf62212d/skills/engineering/research/SKILL.md)                                           | engineering     | Unchanged | Keep                     |
| [retro](https://github.com/mattpocock/skills/blob/4ae2317ddb22b046e26455e4f9c9b3aaaf62212d/skills/engineering/retro/SKILL.md)                                                 | engineering     | Unchanged | Keep                     |
| [setup-matt-pocock-skills](https://github.com/mattpocock/skills/blob/4ae2317ddb22b046e26455e4f9c9b3aaaf62212d/skills/engineering/setup-matt-pocock-skills/SKILL.md)           | engineering     | Unchanged | Keep                     |
| [tdd](https://github.com/mattpocock/skills/blob/4ae2317ddb22b046e26455e4f9c9b3aaaf62212d/skills/engineering/tdd/SKILL.md)                                                     | engineering     | Unchanged | Keep                     |
| [to-spec](https://github.com/mattpocock/skills/blob/4ae2317ddb22b046e26455e4f9c9b3aaaf62212d/skills/engineering/to-spec/SKILL.md)                                             | engineering     | Unchanged | Keep                     |
| [to-tickets](https://github.com/mattpocock/skills/blob/4ae2317ddb22b046e26455e4f9c9b3aaaf62212d/skills/engineering/to-tickets/SKILL.md)                                       | engineering     | Unchanged | Keep                     |
| [triage](https://github.com/mattpocock/skills/blob/4ae2317ddb22b046e26455e4f9c9b3aaaf62212d/skills/engineering/triage/SKILL.md)                                               | engineering     | Unchanged | Keep                     |
| [wayfinder](https://github.com/mattpocock/skills/blob/4ae2317ddb22b046e26455e4f9c9b3aaaf62212d/skills/engineering/wayfinder/SKILL.md)                                         | engineering     | Unchanged | Keep                     |
| [wizard](https://github.com/mattpocock/skills/blob/4ae2317ddb22b046e26455e4f9c9b3aaaf62212d/skills/engineering/wizard/SKILL.md)                                               | engineering     | Unchanged | Keep                     |
| [chief-of-staff](https://github.com/mattpocock/skills/blob/4ae2317ddb22b046e26455e4f9c9b3aaaf62212d/skills/in-progress/chief-of-staff/SKILL.md)                               | in-progress     | Changed   | Keep                     |
| [claude-handoff](https://github.com/mattpocock/skills/blob/4ae2317ddb22b046e26455e4f9c9b3aaaf62212d/skills/in-progress/claude-handoff/SKILL.md)                               | in-progress     | Unchanged | Do not add               |
| [loop-me](https://github.com/mattpocock/skills/blob/4ae2317ddb22b046e26455e4f9c9b3aaaf62212d/skills/in-progress/loop-me/SKILL.md)                                             | in-progress     | Unchanged | Do not add               |
| [setup-ts-deep-modules](https://github.com/mattpocock/skills/blob/4ae2317ddb22b046e26455e4f9c9b3aaaf62212d/skills/in-progress/setup-ts-deep-modules/SKILL.md)                 | in-progress     | Unchanged | Do not add               |
| [software-factory](https://github.com/mattpocock/skills/blob/4ae2317ddb22b046e26455e4f9c9b3aaaf62212d/skills/in-progress/software-factory/SKILL.md)                           | in-progress     | New       | Do not add               |
| [writing-beats](https://github.com/mattpocock/skills/blob/4ae2317ddb22b046e26455e4f9c9b3aaaf62212d/skills/in-progress/writing-beats/SKILL.md)                                 | in-progress     | Unchanged | Do not add               |
| [writing-fragments](https://github.com/mattpocock/skills/blob/4ae2317ddb22b046e26455e4f9c9b3aaaf62212d/skills/in-progress/writing-fragments/SKILL.md)                         | in-progress     | Unchanged | Do not add               |
| [writing-shape](https://github.com/mattpocock/skills/blob/4ae2317ddb22b046e26455e4f9c9b3aaaf62212d/skills/in-progress/writing-shape/SKILL.md)                                 | in-progress     | Unchanged | Do not add               |
| [git-guardrails-claude-code](https://github.com/mattpocock/skills/blob/4ae2317ddb22b046e26455e4f9c9b3aaaf62212d/skills/misc/git-guardrails-claude-code/SKILL.md)              | misc            | Unchanged | Do not add               |
| [migrate-to-shoehorn](https://github.com/mattpocock/skills/blob/4ae2317ddb22b046e26455e4f9c9b3aaaf62212d/skills/misc/migrate-to-shoehorn/SKILL.md)                            | misc            | Unchanged | Do not add               |
| [scaffold-exercises](https://github.com/mattpocock/skills/blob/4ae2317ddb22b046e26455e4f9c9b3aaaf62212d/skills/misc/scaffold-exercises/SKILL.md)                              | misc            | Unchanged | Do not add               |
| [setup-pre-commit](https://github.com/mattpocock/skills/blob/4ae2317ddb22b046e26455e4f9c9b3aaaf62212d/skills/misc/setup-pre-commit/SKILL.md)                                  | misc            | Unchanged | Do not add               |
| [grill-me](https://github.com/mattpocock/skills/blob/4ae2317ddb22b046e26455e4f9c9b3aaaf62212d/skills/productivity/grill-me/SKILL.md)                                          | productivity    | Unchanged | Keep                     |
| [grilling](https://github.com/mattpocock/skills/blob/4ae2317ddb22b046e26455e4f9c9b3aaaf62212d/skills/productivity/grilling/SKILL.md)                                          | productivity    | Unchanged | Keep                     |
| [handoff](https://github.com/mattpocock/skills/blob/4ae2317ddb22b046e26455e4f9c9b3aaaf62212d/skills/productivity/handoff/SKILL.md)                                            | productivity    | Unchanged | Keep                     |
| [teach](https://github.com/mattpocock/skills/blob/4ae2317ddb22b046e26455e4f9c9b3aaaf62212d/skills/productivity/teach/SKILL.md)                                                | productivity    | Unchanged | Keep                     |
| [to-questionnaire](https://github.com/mattpocock/skills/blob/4ae2317ddb22b046e26455e4f9c9b3aaaf62212d/skills/productivity/to-questionnaire/SKILL.md)                          | productivity    | Unchanged | Do not add               |
| [wait-what](https://github.com/mattpocock/skills/blob/4ae2317ddb22b046e26455e4f9c9b3aaaf62212d/skills/productivity/wait-what/SKILL.md)                                        | productivity    | Unchanged | Keep                     |
| [writing-for-agents](https://github.com/mattpocock/skills/blob/4ae2317ddb22b046e26455e4f9c9b3aaaf62212d/skills/productivity/writing-for-agents/SKILL.md)                      | productivity    | Unchanged | Keep                     |

Keep the existing exclusions: `to-questionnaire` is already present upstream at the old pin, so it is not a new skill in this update. It remains optional rather than a prerequisite. The unchanged beta writing experiments, `loop-me`, Claude handoff, TypeScript setup, and misc setup/migration/exercise skills do not justify expanding the kit's general selection. `git-guardrails-claude-code` and `claude-handoff` are explicitly tied to a harness this kit does not support. The manifest's comment describing “full 38” should become “full 39” even though its selected count stays 27. [manifest] [beta]

## Substantive changes

### chief-of-staff: the sole change to a selected skill

The existing beta remains user-invoked (`disable-model-invocation: true`); its description, Codex metadata, scheduling guidance, strategic mandate, and background-subagent requirement do not change. Its instruction diff adds two behaviors. [chief] [chief-commit]

1. **Reuse a shared wiki first.** Look for the wiki the user or other agents already use, follow its conventions, and agree a new location only if none exists. Previously the skill asked for a location when the goal had no wiki. This improves reuse, but a research folder is not automatically a wiki, and a wiki must not become a second source of truth for this repo's glossary or ADRs. Existing historical/dating/citation rules remain.
2. **Run adjacent procedures directly.** Read `../retro/SKILL.md`, `../to-spec/SKILL.md`, `../to-tickets/SKILL.md`, and `../implement-spec/SKILL.md`. Run retro on roughly one in five subagent sessions, prioritizing failures, including sessions dispatched by implement-spec. Instead of retro's final presentation step, chief-of-staff chooses candidates and pursues them itself. For large work, write a spec, split it into tickets, publish both to the issue tracker, then implement.

This is a substantive expansion of action scope, not just wording: retro normally presents candidates to the user; this procedure pursues them. Treat any such changes as bounded by the user's authorized goal and repository standards. Publishing tickets is also an external write and should happen only within the invoked workflow's authorized scope. No retro or ticket publication was performed during this research. [retro] [chief]

All four new relative-path dependencies are already selected. They resolve after the installer flattens copied skills into sibling directories under `~/.agents/skills`. They would not all resolve in upstream's categorized source tree because chief-of-staff lives under `in-progress` while the procedures live under `engineering`; validate the installed tree, not just a source checkout. No supporting file or `agents/openai.yaml` changed in chief-of-staff. [docker] [manifest] [latest-tree]

### software-factory: one new beta skill, six files

This is a user-invoked reference skill for discussing remote systems that turn tickets, PRs and schedules into merged code. It defines Task, Trigger, Run, Runner, Ticket tracker/source, Git host, Orchestrator, and optional Observability platform. It requires answering task triggers, reads/writes, successors, human re-entry, concurrency protection, and ticket deduplication. It recommends buying services, building tasks, adding automation slowly, and using deterministic gates, separate automated review, human review, throttling and bounded retry loops. It is design guidance, not a ready-to-run installer or T3 automation. [factory]

| New file                     | Substance and operational implication                                                                                                                                                                                                                                                                              |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `SKILL.md`                   | Vocabulary, service-slot design, brakes and completion questions; no executable provisioning code.                                                                                                                                                                                                                 |
| `EXAMPLE-TASKS.md`           | Explore, implement, review, rework, decompose, ratchet, fix, architecture and retro patterns; a failed fix does not recursively trigger another fix; human review remains before merge. The ratchet example uses exception lists, which this repository's standards prohibit introducing merely to quiet warnings. |
| `TICKET-TRACKERS.md`         | Tracker categories, human/agent routing, identity, webhook and deduplication questions. GitHub fits existing setup; this is no reason to migrate to another tracker.                                                                                                                                               |
| `GIT-HOSTS.md`               | Git-host categories, event chains, identities, gates and API-budget questions; highlights Actions token event-chain limits.                                                                                                                                                                                        |
| `RUNNERS.md`                 | CI, microVM APIs, hosted agents, bring-your-own workers and own machines; assumes disposable execution and externally held memory.                                                                                                                                                                                 |
| `OBSERVABILITY-PLATFORMS.md` | Deliberate none, tracing platforms, general logging/APM and gateways; distinguishes model-call visibility from tool-call visibility.                                                                                                                                                                               |

The four service surveys explicitly say “Surveyed 2026-10,” warn of staleness, and instruct the agent to research current primary sources before choosing products. Vendor prices, previews and limits in them were not independently validated here; they are upstream survey content, not verified deployment recommendations. All five companion files are newly added, with no scripts or Codex `agents/openai.yaml`. Its absence of Codex UI metadata should be checked in discovery if later selected, rather than treated as proof the skill cannot load. [factory-files]

The remaining changes are the in-progress README entry and two patch changeset files. Neither plugin skill selection, package metadata, top-level README, published docs, nor any other supporting file changed. The new skill is excluded from the plugin; the source-tree inventory is therefore larger than the plugin inventory. Beta skills may change or disappear without warning, a status already applicable to selected chief-of-staff. [compare] [beta] [plugin]

## Operational compatibility with this kit

**Installation and reproducibility.** Retain `skills@1.7.6`, the exact source commit URL, telemetry-off variables, `--agent pi --global --copy --yes`, and the single store at `/home/agent/.agents/skills`. The Dockerfile states this global store serves pi and Codex. The source commit avoids the install-time GitHub API-tree lookup; no new build dependency or network host follows from the two commits. Upstream README plugin auto-updates would contradict ADR 0001's image-owned pin and rebuild model, so do not switch installation mechanisms or install a duplicate plugin. These installer/network properties are existing repo design claims; this research did not rebuild or reproduce the API-blackhole experiment. [docker] [skills-adr] [upstream-readme]

**Codex/pi/T3 invocation.** The changed skill is ordinary Markdown and its new direct file reads avoid dependence on a literal Skill tool for those procedure calls. However, unchanged procedures still contain harness-specific wording: implement-spec says “call the Skill tool,” and research demands a fresh background agent. These are pre-existing portability constraints, not regressions in this update. Map invocation to available tools and respect T3 delegation capabilities, worktree ownership, child no-recursion rules and user limits. A skill's request for background agents does not guarantee a particular provider exposes them. This research ran directly because the task explicitly forbids nested agents. No new hook, service, provider, credential or scheduled task is required by the source delta. [implement-spec] [research] [chief]

**Tracker and labels.** Keep `docs/agents/issue-tracker.md`: GitHub issues in `juranki/t3-code-kit`, `gh` operations, native blocking/sub-issues with documented fallbacks, and PR request surface off. Keep all five default role labels in `docs/agents/triage-labels.md`. Chief-of-staff's new spec/ticket flow can use this setup without migration. Do not rerun setup merely because the pin changes: it is interactive and could overwrite intentional local conventions. [tracker] [labels] [setup]

**Domain and durable state.** Keep the single root `GLOSSARY.md` and `docs/adr/` despite the npm workspace layout; the checked-in domain decision already settles that choice. Do not add `GLOSSARY-MAP.md`, a factory glossary, or a replacement wiki as part of a pin bump. The new factory skill says a runner keeps nothing between runs and a run never waits for a human. That conflicts if applied literally to this kit's interactive T3 sessions and four retained volumes: rebuild preserves repos, threads, projects and worktrees. It also discourages terms such as “issue tracker” and “sandbox” that are intentional here. If explicitly evaluated later, scope its vocabulary to the separate factory design and surface the ADR 0003 conflict; do not implement fresh-runner behavior with `nuke`. [domain] [glossary] [durability] [factory]

**Checks have limits.** Docker build and smoke check directory counts against the manifest. They do not prove exact names, content hashes, supporting-file presence, skill discovery in each harness, or correct tool behavior. `scripts/layout.test.ts` covers workspace/toolchain pins, not a separate skills-ref descriptor field. The descriptor does not carry a mirrored skills source pin to bump. Keep existing count guards, and supplement them with exact installed-name/content checks during acceptance. [docker] [smoke] [layout]

## Concrete implementation plan (not performed)

1. **Make the minimal source change.** In `kit/t3-code.dockerfile`, set `SKILLS_REF=4ae2317ddb22b046e26455e4f9c9b3aaaf62212d`. Leave `SKILLS_VERSION=1.7.6` and provider/toolchain pins unchanged. In `kit/skills.txt`, retain all 27 names and update the inventory comment from 38 to 39; optionally date the review. No renames or replacement commands are needed.
2. **Keep policy and setup stable.** No required edits to `kit/t3-code.yaml`, `kit/skills.sh`, `kit/serve.sh`, network policy, credentials, README, `AGENTS.md`, `GLOSSARY.md`, or `docs/agents/*.md`. ADR 0001 remains valid; no new ADR is needed for a routine pin bump. Record target and behavioral caveat in the implementation PR, referencing this report. Do not add software-factory as incidental scope.
3. **Validate source and the gate.** Resolve every manifest name against the target's `SKILL.md` frontmatter, confirm uniqueness and exactly 27 matches, check sibling dependencies and compare changed installed content to the reviewed source. Run `npm run check`; warnings or unrelated failures must be reported, never suppressed. If adding permanent name/content assertions, the likely files are `scripts/smoke.ts`, `scripts/smoke.test.ts` and possibly a dedicated manifest/layout test; this is useful hardening but not necessary to implement the minimal pin bump.
4. **Build and accept on a disposable host instance.** Use `npm run smoke -- <unique-scratch-name>` on an authorized host with real `sbx` and stored credentials, following the dev-loop guide. Smoke builds from the kit and includes destructive lifecycle checks, so never point it at a working instance. Verify the build's 27 count, exact installed directory-name set, absence of copied cache symlinks, chief-of-staff's reviewed instructions, and all four sibling procedure files. Compare every selected directory's content with upstream and check supporting files survive copying. For a future software-factory trial, require all six files and 28 exact names in a separately reviewed selection change.
5. **Check harness behavior.** In fresh pi and Codex sessions through the target T3 runtime, confirm the 27 skills are discoverable without duplicate plugin copies. Exercise chief-of-staff only in a bounded disposable goal: shared-wiki discovery, honoring local conventions, direct procedure-path reads and correct tracker choice. Inspect its behavior around retro candidates before authorizing broad autonomous work. Do not use real issue creation or production automation merely to test skill discovery.
6. **Roll out by rebuild.** After host acceptance, run `npm run rebuild -- <instance-name>` for each intended instance, coordinating with active users because it recreates the instance. Confirm skill names/content again and that durable state survives. Restarting alone does not change baked-in content. Do not run runtime `skills update`, add a volume over `.agents`, or use `nuke`. Rollback means restore the old source pin (and any manifest change), rebuild again, and verify retained state; no data migration is needed. [skills-adr] [durability] [dev-loop]

Required future changed files are just `kit/t3-code.dockerfile` and the comment in `kit/skills.txt`; this report is the planning artifact. All other files above are validation surfaces or explicitly conditional hardening work.

## Verification of this report

Source comparison used `git log`, `git diff --stat`, `git diff --name-status`, recursive `git ls-tree`, direct instruction/supporting-file reads and remote HEAD verification. The report's full inventory is generated from target Git paths and matched against the local selection. No build, runtime installer, issue write, automation setup, or sandbox rebuild was performed. All 27 unique manifest names were also matched against target frontmatter; only the chief-of-staff selected directory has a content delta. Citation reference labels resolve. The first formatting/gate attempt failed because workspace dependencies were absent. After `npm ci` and formatting only this report, `npm run check` passed: formatting, lint with zero warnings, typecheck, and **205 tests across 13 files**. Only this report is changed in Git; no unrelated issues were fixed.

## Primary sources

Upstream links use exact commits. Local links identify the checked-in integration surfaces inspected for this report.

[base-tree]: https://github.com/mattpocock/skills/tree/a496f5513d4a4cf889bc48e189e579f4b0bdf6aa/skills
[latest-tree]: https://github.com/mattpocock/skills/tree/4ae2317ddb22b046e26455e4f9c9b3aaaf62212d/skills
[latest]: https://github.com/mattpocock/skills/commit/4ae2317ddb22b046e26455e4f9c9b3aaaf62212d
[chief-commit]: https://github.com/mattpocock/skills/commit/5ae481693d13b37d4d2c2c92d0b66d299c93e695
[compare]: https://github.com/mattpocock/skills/compare/a496f5513d4a4cf889bc48e189e579f4b0bdf6aa...4ae2317ddb22b046e26455e4f9c9b3aaaf62212d
[package]: https://github.com/mattpocock/skills/blob/4ae2317ddb22b046e26455e4f9c9b3aaaf62212d/package.json
[plugin]: https://github.com/mattpocock/skills/blob/4ae2317ddb22b046e26455e4f9c9b3aaaf62212d/.claude-plugin/plugin.json
[chief-changeset]: https://github.com/mattpocock/skills/blob/4ae2317ddb22b046e26455e4f9c9b3aaaf62212d/.changeset/chief-of-staff-shared-wiki-procedures.md
[factory-changeset]: https://github.com/mattpocock/skills/blob/4ae2317ddb22b046e26455e4f9c9b3aaaf62212d/.changeset/software-factory-skill.md
[chief]: https://github.com/mattpocock/skills/blob/4ae2317ddb22b046e26455e4f9c9b3aaaf62212d/skills/in-progress/chief-of-staff/SKILL.md
[beta]: https://github.com/mattpocock/skills/blob/4ae2317ddb22b046e26455e4f9c9b3aaaf62212d/skills/in-progress/README.md
[factory]: https://github.com/mattpocock/skills/blob/4ae2317ddb22b046e26455e4f9c9b3aaaf62212d/skills/in-progress/software-factory/SKILL.md
[retro]: https://github.com/mattpocock/skills/blob/4ae2317ddb22b046e26455e4f9c9b3aaaf62212d/skills/engineering/retro/SKILL.md
[upstream-readme]: https://github.com/mattpocock/skills/blob/4ae2317ddb22b046e26455e4f9c9b3aaaf62212d/README.md
[implement-spec]: https://github.com/mattpocock/skills/blob/4ae2317ddb22b046e26455e4f9c9b3aaaf62212d/skills/engineering/implement-spec/SKILL.md
[research]: https://github.com/mattpocock/skills/blob/4ae2317ddb22b046e26455e4f9c9b3aaaf62212d/skills/engineering/research/SKILL.md
[setup]: https://github.com/mattpocock/skills/blob/4ae2317ddb22b046e26455e4f9c9b3aaaf62212d/skills/engineering/setup-matt-pocock-skills/SKILL.md
[factory-files]: https://github.com/mattpocock/skills/tree/4ae2317ddb22b046e26455e4f9c9b3aaaf62212d/skills/in-progress/software-factory
[docker]: ../../kit/t3-code.dockerfile
[manifest]: ../../kit/skills.txt
[skills-adr]: ../adr/0001-skills-baked-into-image.md
[tracker]: ../agents/issue-tracker.md
[labels]: ../agents/triage-labels.md
[domain]: ../agents/domain.md
[glossary]: ../../GLOSSARY.md
[durability]: ../adr/0003-durability-model.md
[smoke]: ../../scripts/smoke.ts
[layout]: ../../scripts/layout.test.ts
[dev-loop]: ../operations/v2-dev-loop.md
