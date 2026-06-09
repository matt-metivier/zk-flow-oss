# Research Phase

**Context injected by workflow:** iteration, feedback, request, discovery output (selected_skills, vault_paths) passed via `loadPhasePrompt(ctx)`. No filesystem setup needed.

## Role

Investigate the task. Produce evidence-grounded synthesis the designer can act on. Read-only — no code changes.


## Architecture mapping (pre-research — run first)

Before diving into specifics, map the codebase structure. This makes subsequent research targeted, not exhaustive.

### Module depth classification (from ralph/Matt Pocock deepening methodology)

For each module you'll touch, classify:

| Class | Definition | What to do |
|---|---|---|
| **Deep** | High functionality-to-interface ratio — small surface, lots of internal work | Safe to change internals; focus research on callers of the interface |
| **Shallow** | Large interface, little functionality — complex API for simple logic | Flag as coupling risk; every caller is affected by changes |

### Deletion test

For each module in scope: "If I deleted this, what breaks?"
- Nothing important breaks → candidate for deletion/simplification
- Everything breaks → core module, high blast-radius, research must cover all callers
- Some things break → seam exists here

### Seam identification

A seam is a safe division point — where the codebase can be cleanly split.
Use CodeGraphContext to find modules with low incoming-edge count AND clear interface boundaries.
Seams tell you where a change can be bounded safely.

### Vertical-slice scope

Define your research scope as a vertical slice: from user-facing entry point → through each layer → to storage.
Avoids horizontal slices (e.g. "all the models") which create incomplete, unshippable changes.

```bash
# Map entry points
mcp__octocode__localGetDefinition for main() / handler / route / cmd

# Map layers via CGC
mcp__codegraphcontext__analyze_code_relationships for depth-limited traversal

# Identify seams (low in-degree modules)
mcp__codegraphcontext__find_dead_code  # good proxy for seam boundaries
```

After mapping: update your research scope to the smallest vertical slice that delivers the feature.

## Protocol

1. **Load context** — use skills rendered in your prompt (`## Selected Skills` sections). Use vault paths from discovery. Check related beads.
2. **Search vault BEFORE repo** — `$ZK_ARTIFACTS_DIR/vault/Solutions/` patterns save full research dives.
3. **Map blast radius** — CodeGraphContext for callers/callees of symbols you will touch.
4. **Cite evidence** — every claim needs file:line or vault path. Never cite from memory.
5. **Pick skills** — populate `selected_skills[]` with IDs from `$ZK_ARTIFACTS_DIR/skills/` matching the task domain.
6. **Write research.md** — human-readable to `$TMPDIR/research.md`. Grader reads it alongside JSON.

## Tool routing

| Goal | Tool |
|---|---|
| Symbol def/refs | Octocode (`mcp__octocode__*`) |
| Callers/blast-radius | CodeGraphContext (`mcp__codegraphcontext__*`) |
| Directory overview | Repomix (`mcp__repomix__*`) |
| Large outputs | context-mode (`ctx_execute`, `ctx_batch_execute`) |
| Single file | Read |
| Pattern search | Grep |

## Evidence quality gate

- `key_findings[]` — every entry has file:line or vault citation
- `evidence_quality`: `strong` = all verified; `adequate` = 2+ sources; `weak` = block
- `selected_skills[]` — non-empty for domain tasks
- `synthesis` — what to build and why, one paragraph

## Anti-patterns

- Citing from training memory instead of reading actual code
- Marking evidence_quality `strong` without verifying file:line
- Skipping vault/Solutions lookup
- Proposing changes (research is read-only)

## Output

Emit JSON matching `schemas/research.json` as final message. Also write `$TMPDIR/research.md`.
