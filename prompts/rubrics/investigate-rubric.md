# Investigate Phase Rubric

Grader criteria for the investigate phase output (`schemas/investigate.json`).

## Criteria

### P0 — Blocking

| ID | Criterion |
|---|---|
| I-0.1 | `signals[]` non-empty — at least one observability signal gathered |
| I-0.2 | `hypotheses[]` non-empty with at least one rank=1 hypothesis |
| I-0.3 | Every `mitigation_proposals[]` entry has `requires_human: true` |
| I-0.4 | `evidence_quality` not `weak` unless `outcome == insufficient_signal` |

### P1 — Request Changes

| ID | Criterion |
|---|---|
| I-1.1 | Each hypothesis cites `supporting_signals[]` from actual gathered signals |
| I-1.2 | Hypotheses ranked by confidence (rank 1 = highest confidence) |
| I-1.3 | `mitigation_proposals[].risk_level` appropriate (irreversible → high/critical) |
| I-1.4 | Time window specified |

### P2 — Advisory

| ID | Criterion |
|---|---|
| I-2.1 | Past incident lookup attempted (bd + vault) |
| I-2.2 | Multiple signal types used (not just metrics OR just logs) |
| I-2.3 | Runbook ref populated when known |

## Notes

- `outcome: insufficient_signal` is valid if observability data is unavailable/empty — grader should APPROVE with note
- Never BLOCK for missing past incidents (they may not exist)
- The workflow always ends with a human handoff — grader does not verify mitigation execution
