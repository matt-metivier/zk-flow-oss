Onboard this machine to zk-flow — idempotently fix the setup pieces `/health` only reports.

Arguments: $ARGUMENTS

Unlike `/health` (read-only verification), `/onboard` **fixes**: it wires the user-scope
MCP servers (repomix, octocode), syncs the repo agents into `~/.claude/agents` (the
migration step that goes stale — live agents load from there, not the repo), runs `bd init`
if the beads DB is missing, regenerates a stale `skills/CATALOG.md`, installs the
zk-artifacts skills into `~/.claude/skills` so ordinary sessions can find them, builds the
workflows, and surfaces the few things it can't safely auto-fix (shell-profile exports,
missing personas) as exact commands to run.

**Skills come from two places now, and onboard keeps them from overlapping.** The
`zkengine` plugin carries every skill whose directory lives inside zk-artifacts (73 here).
`install-skills.sh` symlinks only the remainder — skills that are symlinks to a repo
OUTSIDE zk-artifacts, which a plugin cache cannot follow (15 here, the nebo/* tools).
Running both in full would publish every skill twice under two names for no added coverage.
`/health` asserts the invariant: every catalog skill reachable exactly once.

**On skills specifically** (the step that was missing until now): Claude Code discovers
skills one level deep — `~/.claude/skills/<name>/SKILL.md`. The zk-artifacts tree nests up
to five levels (`skills/agent/machines/n/nebo/jira`), so nothing there was visible in a
normal session; only workflow-rendered prompts saw them. `scripts/install-skills.sh`
flattens the catalog into `~/.claude/skills/zk-<name>` symlinks (host-scoped: other
machines' and archived skills are skipped — pass `--all` to include them) and prunes links
whose catalog id disappeared. Re-run `/onboard` after adding, renaming, or collapsing a
skill; restart the session to pick up new ones.

Safe to re-run anytime — every step checks-then-fixes and no-ops when already correct.

**Run:**
```bash
bash "${ZK_FLOW_DIR:-$HOME/dev/zk-flow}/scripts/onboard.sh"
```

Then run `/health` for a fail-hard verification pass. Report the `FIX`/`WARN` lines to the
user; resolve any `WARN` (missing CLI, unset `ZK_ARTIFACTS_DIR`/`BEADS_DIR`, absent persona)
before running other workflows.

**Index the knowledge base into context-mode** (so `ctx_search` retrieves zk-flow/vault
answers without re-reading files) — run once per machine, idempotent:

- `ctx_index` `${ZK_FLOW_DIR:-$HOME/dev/zk-flow}/docs` (workflow + architecture + onboarding docs)
- `ctx_index` `${ZK_ARTIFACTS_DIR:-$HOME/dev/zk-artifacts}/vault/Map of Contents` (KB index)

After indexing, prior decisions/docs are one `ctx_search` away instead of a file crawl.
