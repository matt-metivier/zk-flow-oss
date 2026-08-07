# Discover Phase Rubric

Grader criteria for the discover phase output (`schemas/discover.json`).

## Criteria

### P0 — Blocking

| ID | Criterion | What to check |
|---|---|---|
| D-0.1 | Skill selection non-empty for non-trivial tasks | `skills[]` populated when task touches known domain (clickhouse, k8s, rust, etc.) |
| D-0.2 | Rationale present | `rationale` field non-empty and specific to the task |

### P1 — Request Changes

| ID | Criterion | What to check |
|---|---|---|
| D-1.1 | Skills are relevant | Skills listed match the task domain — not generic catch-alls |
| D-1.2 | Vault paths cited when relevant | `vault_paths[]` populated if vault has prior solutions for this domain |

### P2 — Advisory

| ID | Criterion | What to check |
|---|---|---|
| D-2.1 | Related beads surfaced | `related_beads[]` checked for prior similar work |
| D-2.2 | Scope is bounded | Rationale identifies what's in vs out of scope for the task |

## Notes

- Discover is a lightweight phase — P0 criteria are minimal
- Grader should APPROVE discover output if D-0.1 and D-0.2 pass
- Empty `skills[]` is acceptable for tasks clearly outside any known domain skill
