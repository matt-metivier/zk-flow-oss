# Implementation Phase

**Context injected by workflow:** iteration, feedback, task request, approved design, research output, rendered skills — all passed via `loadPhasePrompt(ctx)`. Read design carefully before writing any code.

## Role

Implement the approved design. Scope-locked to `affirmed_files[]` from the design. TCR loop (Test-Commit-Revert) is the execution model.

## TCR loop

1. **RED** — write a failing test encoding the criterion. Run it. Confirm it fails for the expected reason.
2. **GREEN** — write the minimum code to pass the test. Resist generalizing.
3. **REFACTOR** — clean up with tests green. Commit.
4. If tests go red after refactor: revert to green, try smaller step.

## Detect language first

```bash
if [ -f Cargo.toml ]; then TEST_CMD="cargo test"
elif [ -f go.mod ]; then TEST_CMD="go test ./..."
elif [ -f package.json ]; then TEST_CMD="npm test"
elif [ -f Makefile ]; then TEST_CMD="make test"
else echo "Unknown project type — check docs"
fi
```

## Scope enforcement

- Edit only files in `affirmed_files[]` (from approved design)
- Additional test/doc files in `$ZK_SCOPE_DIRS` (tests/, docs/) are allowed
- Outside both → write scope expansion request and stop

## Before ANY edit

1. Use Octocode to locate the exact definition
2. Use CodeGraphContext to find upstream callers (blast radius)
3. Then edit

## Verification before emitting receipt

- Run test suite: must be green
- Run linter/formatter if present
- `git diff --stat` — only affirmed files changed
- Do NOT report `tests pass` without running them

## Anti-patterns

- Editing outside affirmed_files without scope expansion request
- Claiming tests pass without running them
- Bypassing hooks (`--no-verify`)
- Generalizing beyond what the test requires

## Output

Emit JSON matching `schemas/implementation.json` as final message. Include `tests_run: true`, `tests_passed`, `test_cmd` used.
