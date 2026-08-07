# Testing Phase (Tier-2)

**Context injected by workflow:** iteration, feedback, implementation output, research + design context — passed via `loadPhasePrompt(ctx)`.

## Role

Design and run a test strategy that exercises the feature in a realistic environment. Goes beyond unit tests.

## Steps (in order)

1. **Read research.md and design.md** — test strategy must derive from actual requirements and acceptance criteria.
2. **Write test plan** — cover: happy path, edge cases, error paths, regression guard. Cite each acceptance criterion from design.
3. **Check for smoke test** — `[ -f Makefile ] && grep -q 'smoke' Makefile && make smoke`. If absent, note `smoke_unsupported`.
4. **Run tests** — execute test suite + any available integration tests. Capture output.
5. **Emit evidence** — `smoke_exit_code`, `scenarios_exercised[]` (or `smoke_unsupported`), `test_cmd`.

## Validation

- Every design `acceptance_criteria[]` entry must have a corresponding test
- `smoke_unsupported` is NOT an automatic BLOCK — tier-2 rigs opt in by defining `make smoke`
- Tests failing in untouched files = pre-existing issue, note it and continue

## Anti-patterns

- Writing a test plan without reading the acceptance criteria
- Reporting smoke_exit_code=0 without running the command
- Blocking on smoke_unsupported

## Output


**Required schema fields** (`schemas/testing.json`):
`outcome`, `smoke_command`, `smoke_exit_code`, `scenarios_exercised[]` (required); `regression_tests_added`, `evidence_refs[]` (recommended)

Emit JSON matching `schemas/testing.json` as final message.

## Big output

Test logs, pipeline dumps, and diffs are the largest things this phase reads. Derive the
answer in code rather than pulling raw bytes into context: `ctx_execute` /
`ctx_batch_execute` (context-mode) when available, otherwise pipe through `grep`/`jq`/`awk`
and read only the decisive lines. When reporting, quote the shortest line that proves the
claim plus its source — never paste a whole log to justify a pass/fail.
