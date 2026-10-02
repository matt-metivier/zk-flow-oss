Register, list, or check zk-artifacts skills: `scripts/skills.sh`

Arguments: $ARGUMENTS

Run `bash "${ZK_FLOW_DIR:-$HOME/dev/zk-flow}/scripts/skills.sh" $ARGUMENTS` and show the output verbatim.

**Subcommands:**
- `register` -- after adding, renaming, or removing a skill: regenerate `CATALOG.md`, relink `~/.claude/skills/zk-*`, verify both. Restart the session to see new `/zk-*` skills.
- `list` -- every skill this host can load, its `/zk-<name>`, catalog id, and whether it is linked.
- `check` -- exit 1 if the catalog or links are stale, or this host has no `agent/machines/<host>/mr-conventions` review standard.

**Example:** `/skills register`
