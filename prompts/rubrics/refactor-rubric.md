# Refactor Phase Rubric

Grader criteria for refactor phase output. Uses implementation schema.
Behavior-preservation is the KEY additional criterion beyond standard implementation rubric.

## P0 — Blocking

| ID | Criterion |
|---|---|
| R-0.1 | All call sites identified in research are updated |
| R-0.2 | No public contract (API, schema, exported symbol) changed |
| R-0.3 | Test suite passes without modifying test expectations |
| R-0.4 | `files_changed[]` matches `affirmed_files[]` from design |

## P1 — Request Changes

| ID | Criterion |
|---|---|
| R-1.1 | Each changed file has a rationale tied to the refactor target |
| R-1.2 | No new behavior introduced (strictly structural) |
| R-1.3 | CGC blast-radius was checked before each symbol edit |

## P2 — Advisory

| ID | Criterion |
|---|---|
| R-2.1 | Commit message explains the structural change |
| R-2.2 | CHANGELOG.md updated if public-facing |
