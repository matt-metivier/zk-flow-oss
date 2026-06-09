# Self-Improvement Phase Rubric

Grader criteria for reflector proposals. Uses proposal schema.

## P0 — Blocking

| ID | Criterion |
|---|---|
| SI-0.1 | Each proposal has ≥2 evidence beads cited in `evidence_beads[]` |
| SI-0.2 | `target` field is a valid file path that exists in the repo |
| SI-0.3 | `mutation_type` is one of: rubric_clarification, skill_addition, skill_update, schema_tightening |
| SI-0.4 | No proposal targets a protected skill from `$ZK_ARTIFACTS_DIR/protected.json` |

## P1 — Request Changes

| ID | Criterion |
|---|---|
| SI-1.1 | `rationale` ≤ 300 chars and cites specific GraderFeedback patterns |
| SI-1.2 | `description` ≤ 200 chars |
| SI-1.3 | `diff_sketch` shows concrete before/after for the mutation |
| SI-1.4 | Max 8 proposals per cycle |

## P2 — Advisory

| ID | Criterion |
|---|---|
| SI-2.1 | Proposals are diverse (not all targeting same phase) |
| SI-2.2 | Cluster coverage: most-frequent rubric gaps addressed first |
