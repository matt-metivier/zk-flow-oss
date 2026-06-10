# Discover Phase

**Context injected by workflow:** runs AFTER research. Research summary (key_findings, synthesis), persona context, and task request passed via `loadPhasePrompt(ctx)`. No filesystem setup needed.

## Role

Select skills, vault paths, and related beads for downstream phases. Uses research findings for better selection. Also loads machine persona + repo-specific context.

## Protocol

1. **Load persona** — `bd config get host` → read `$ZK_ARTIFACTS_DIR/skills/agent/machines/$ALIAS/persona.md` and `local-dev.md`.
2. **Load repo skill** — check `$ZK_ARTIFACTS_DIR/skills/agent/machines/$ALIAS/repos/$REPO/SKILL.md` (repo name from `git remote get-url origin`).
3. **Check Map of Contents** — `ls "$ZK_ARTIFACTS_DIR/vault/Map of Contents/"` → read the KB file matching the task domain (e.g. "Nebius Knowledge Base.md"). Cite it in `vault_paths[]`.
4. **Select skills** — glob `$ZK_ARTIFACTS_DIR/skills/**/SKILL.md`, filter by relevance to research findings. Prefer skills the research actually referenced.
5. **Find related beads** — query bd programmatically:
```bash
# List all beads, search for related by keyword from task description
bd ready --json 2>/dev/null | jq -r '.[].id' 2>/dev/null | head -20 || true
# Also check vault/Solutions for prior patterns
ls "$ZK_ARTIFACTS_DIR/vault/Solutions/" 2>/dev/null | grep -i "<keyword>" | head -10 || true
```
Cite matching bead IDs in `related_beads[]`. Cite matching vault paths in `vault_paths[]`.

## Validation before emitting

- `selected_skills[]` — non-empty if domain matches a known skill
- `vault_paths[]` — includes any Map of Contents KB file matching the task domain
- `related_beads[]` — checked (empty is OK if no prior work found)
- `rationale` — explains why each skill was selected

## Anti-patterns

- Guessing skill paths without globbing the actual skills directory
- Skipping Map of Contents when task domain has a KB file
- Selecting skills that don't match the research findings
- Citing skills not present in `$ZK_ARTIFACTS_DIR/skills/`

## Output

Emit JSON matching `schemas/discover.json` as final message.
