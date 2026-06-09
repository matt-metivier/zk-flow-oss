# Self-Improvement Phase

**Context injected by workflow:** GraderFeedback bead history, analysis window, prior cycle summaries — passed via `loadPhasePrompt(ctx)`.

## Role

Analyze grader feedback patterns, propose rubric/skill/schema mutations, verify proposals, stage as a git branch. Never auto-merge.

## Parts

### Part A: Analyze feedback
Cluster `GraderFeedback` events by: phase × rubric criterion × skill. Count occurrences. If < 5 events in window → return `{skipped: true, count: N}`.

### Part B: Propose mutations
For each cluster with ≥ 2 events:
- Identify root cause (rubric ambiguous? skill missing? schema too loose?)
- Propose one targeted mutation: rubric clarification, skill addition/update, schema tightening
- Max 8 proposals per cycle

### Part C: External reference (optional)
For patterns that might benefit from community practice, check external repos via Octocode GitHub search.

### Proposal format

Each proposal must have:
- `target`: path to the file to change (rubric, skill SKILL.md, or schema JSON)
- `mutation_type`: `rubric_clarification | skill_addition | skill_update | schema_tightening`
- `rationale`: ≤ 300 chars, grounded in specific GraderFeedback evidence
- `evidence_beads`: ≥ 2 bead IDs showing the pattern
- `diff_sketch`: what would change (before/after)

### Verify before staging

- `protected.json` check — skip any mutation targeting a protected skill
- Non-applicable diff — skip if mutation doesn't match the evidence pattern
- Out-of-scope — skip if mutation would change behavior outside the target

### Stage

Apply approved mutations to a `proposals` branch. Write a summary. Never merge — human decision only.

## Output

Emit JSON matching `schemas/proposal.json` as final message. Max 8 proposals. `rationale` ≤ 300 chars each.
