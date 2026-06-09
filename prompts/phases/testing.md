# Testing Phase (Tier-2)

**Context injected by workflow:** iteration, feedback, implementation output, research + design context — passed via `loadPhasePrompt(ctx)`.

## Role

Design and run a test strategy that exercises the feature in a realistic environment. Goes beyond unit tests.

## Steps (in order)

1. **Read research.md and design.md** — test strategy must derive from actual requirements and acceptance criteria.
2. **Write test plan** — cover: happy path, edge cases, error paths, regression guard. Cite each acceptance criterion from design.
3. **Check for smoke test** — `[ -f Makefile ] && grep -q 'smoke' Makefile && make smoke`. If absent, note `smoke_unsupported`.
4. **Run tests** — execute test suite + any available integration tests. Capture output.
5. **Emit evidence** — `tests_passed`, `tests_failed`, `smoke_exit_code` (or `smoke_unsupported`), `test_cmd`.

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
`outcome`, `smoke_command`, `smoke_exit_code`, `scenarios_exercised[]`, `regression_tests_added`

Emit JSON matching `schemas/testing.json` as final message.
