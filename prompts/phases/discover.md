# Discover Phase

**Context injected by workflow:** runs AFTER research. Research summary (key_findings, synthesis), persona context, and task request passed via `loadPhasePrompt(ctx)`. No filesystem setup needed.

## Role

Select skills, vault paths, and related beads for downstream phases. Uses research findings for better selection. Also loads machine persona + repo-specific context.

## Protocol

> **Run the independent lookups in parallel.** Steps 1-3, 5, and 6 touch different
> sources (persona files, the skills glob, the vault MoC, bd, GitHub) and do not
> depend on each other — issue their reads/greps in a single parallel batch, then
> reconcile. Do not serialize five round-trips.

1. **Load persona** — `bd config get host` → read `$ZK_ARTIFACTS_DIR/skills/agent/machines/$ALIAS/persona.md` and `local-dev.md`.
2. **Load repo skill** — check `$ZK_ARTIFACTS_DIR/skills/agent/machines/$ALIAS/repos/$REPO/SKILL.md` (repo name from `git remote get-url origin`).
3. **Check Map of Contents** — `ls "$ZK_ARTIFACTS_DIR/vault/Map of Contents/"` to see the available KBs, then **read** the one(s) matching the task domain (e.g. "<org> Knowledge Base.md") — a MoC file is an index of links, so follow it to the specific vault notes it points at, don't stop at the filename. Cite both the MoC and any followed notes in `vault_paths[]`.
4. **Select skills** — glob `$ZK_ARTIFACTS_DIR/skills/**/SKILL.md`, filter by relevance to research findings. Prefer skills the research actually referenced.
5. **Find related beads** — query bd programmatically. Bound the retrieval: 5 same-subject
   plus 3 most-recent is enough context and keeps an unrelated bead from being read as
   precedent. An unrelated bead is worse than none.
```bash
# List all beads, search for related by keyword from task description
# bd ready only returns open unblocked issues — run-memory beads are task-type, search ALL beads:
# Bounded retrieval, same shape as bdBoundedContext(): same-subject first, then recency.
# `grep`ing the whole board returns whatever happens to share a word; searching ranks.
bd search "<keyword>" --sort created --reverse --limit 5 --json 2>/dev/null || true
bd list --sort created --reverse --limit 3 --json 2>/dev/null || true
# READ the top 1-3 matches — the typed phase comments (GraderFeedback, ProofOfWork,
# Design) are the high-signal history, not the title. bd show alone misses them:
bd comments <bead-id> 2>/dev/null | head -60 || true
# Consult durable cross-session learnings (injected at bd prime; written by /improve):
bd memories "<keyword>" 2>/dev/null || true
# Also check vault/Solutions for prior patterns
ls "$ZK_ARTIFACTS_DIR/vault/Solutions/" 2>/dev/null | grep -i "<keyword>" | head -10 || true
```
Cite matching bead IDs in `related_beads[]` and summarize any reusable prior outcome (from `bd comments`/`bd memories`) in `rationale`. Cite matching vault paths in `vault_paths[]`.

6. **Prior art (optional, when the task is a known-pattern feature)** — search GitHub for how others solved it via Octocode (`mcp__octocode__*`: code/PR search across repos — its differentiator over local tools). One focused query keyed off the research findings; fold any reusable approach into `rationale`. Skip for repo-local or trivial tasks. Do NOT block discovery on network — best-effort.

## Validation before emitting

- `skills[]` — non-empty if domain matches a known skill
- `vault_paths[]` — includes any Map of Contents KB file matching the task domain
- `related_beads[]` — top 1-3 matches' `bd comments` + `bd memories` actually read, not just title-grepped (empty is OK if no prior work found)
- `rationale` — explains why each skill was selected

## Anti-patterns

- Guessing skill paths without globbing the actual skills directory
- Skipping Map of Contents when task domain has a KB file
- Selecting skills that don't match the research findings
- Citing skills not present in `$ZK_ARTIFACTS_DIR/skills/`

## Output

Emit JSON matching `schemas/discover.json` as final message.
