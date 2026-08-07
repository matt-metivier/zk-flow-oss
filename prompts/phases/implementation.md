# Implementation Phase

**Context injected by workflow:** iteration, feedback, task request, approved design, research output, rendered skills — all passed via `loadPhasePrompt(ctx)`. Read design carefully before writing any code.

## Role

Implement the approved design. Scope-locked to `affirmed_files[]` from the design. TCR loop (Test-Commit-Revert) is the execution model.

## TCR loop (test-first; superpowers:test-driven-development)

1. **RED** — write a failing test encoding the criterion. Run it. Confirm it fails for the expected reason.
2. **GREEN** — write the minimum code to pass the test. Resist generalizing.
3. **REFACTOR** — clean up with tests green. Commit.
4. If tests go red after refactor: revert to green, try smaller step.

## Restraint ladder (skills/general/practices/restraint)

Before adding any symbol, file, dependency, or config knob, stop at the first rung that holds: (1) does it need to exist? → skip (YAGNI); (2) stdlib? (3) native platform? (4) installed dep? (5) one line? (6) only then the minimum that works. Never cut the floor — validation, data-loss handling, security, accessibility stay. Mark deliberate shortcuts with `// restraint: <upgrade path>`.

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
2. Use codebase-memory-mcp to find upstream callers (blast radius)
3. Then edit

## Verification before emitting receipt (superpowers:verification-before-completion)

- Run test suite: must be green
- Run linter/formatter if present
- `git diff --stat` — only affirmed files changed
- Do NOT report `tests pass` without running them — evidence (output/exit code) before assertions

## Anti-patterns

- Editing outside affirmed_files without scope expansion request
- Claiming tests pass without running them
- Bypassing hooks (`--no-verify`)
- Generalizing beyond what the test requires
- Claiming `lifecycle_complete` with `tests_run=false` by writing failures off as "pre-existing" without a baseline run. If `tests_run=false`, state the specific blocking reason (Docker-only CI, missing credentials, sandbox limit) in `approach_rationale` — never emit `lifecycle_complete` with `tests_run=false` and an empty/absent reason. When you suspect pre-existing failures, run the suite on the untouched base first to establish the baseline, then attribute.

## Output


**Required schema fields** (`schemas/implementation.json`):
`outcome`, `files_changed[]`, `commits[]`, `tests_run`, `tests_passed`, `tests_failed`, `approach_rationale` (required); `test_cmd`, `git_baseline_sha` (recommended — live-verified `git rev-parse origin/<branch>` that `files_changed[]` is diffed against)

**Push is part of done.** When the work targets an existing PR/MR branch or the workflow will open one, commit AND push to the remote branch before emitting output — a fix that exists only locally does not count (live run 2026-06-12: review fixes were committed but never pushed). If push fails, resolve and retry; report the push result in `outcome`.

Emit JSON matching `schemas/implementation.json` as final message. Include `tests_run: true`, `tests_passed`, `test_cmd` used.
