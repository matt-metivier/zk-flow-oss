# Design: backtrack-on-failure gate recovery (issue #41)

`/feature` design-phase output (PM-fallback run). Stops here for human approval — resume with `/feature startAt=impl`.

## Situation

`runPhase` (`src/fragments/run-phase.js`) is a per-phase grade-gated loop: run phase agent → grader → APPROVE advances; else iterate to `maxIterations`, then climb the tier ladder (`fast→mid→deep`, one shot each via `nextTier`). If still no APPROVE it returns `{ ok:false, ... }`. Every workflow (`feature`, `bugfix`, `debug`, ...) treats `ok:false` as terminal → `handoffPrompt(...)` → `return { verdict: 'needs_human' }`. `runPhase` is per-phase: it has no knowledge of sibling phases, so it cannot re-run a prior one itself.

## Complication

Tier escalation only buys a *bigger model on the same phase*. When impl keeps failing because the **design** was wrong, escalating the impl model can't fix it — the run dies at `needs_human` with no attempt to revisit the upstream phase. Arnold's harness (eval INSPIRE, EVALS.md) backtracks on failure: re-plan the prior step with the failure as evidence before giving up. We want that recovery, bounded, **without** changing default behavior or destabilizing the gate loop.

## Question

1. Where does backtrack orchestration live, given `runPhase` can't reach sibling phases?
2. How do we bound it (no infinite design↔impl loop)?
3. How is it opt-in so default behavior is byte-identical and all 245 tests stay green?

## Answer

### Approach A (CHOSEN): additive signal + thin orchestration helper

1. **`run-phase.js` (additive only):** include `backtrackEligible: true` on the exhausted `{ok:false}` return. Existing callers ignore unknown fields → zero behavior change. This is the *trigger primitive*.
2. **New `src/fragments/backtrack.js`:** `runWithBacktrack(prevRunner, curRunner, { budget })`.
   - `budget` defaults to `0` → it just runs `curRunner()` and returns — **identical to today** when off.
   - When `budget > 0` and `cur` returns `ok:false && backtrackEligible`: re-run `prevRunner(feedback)` once, then `curRunner()` once, decrementing `budget`, until `cur.ok` or budget hits 0. Then fall through to the caller's existing `needs_human` handoff.
   - `prevRunner`/`curRunner` are thunks the workflow already has (closures over its `runPhase({...})` configs), so the helper needs no per-phase knowledge.
3. **`src/fragments/budgets.js`:** add `PHASE_BUDGETS.backtrack = 0` (off by default). A workflow (or `a.backtrack=<n>` arg) opts in.
4. **Opt-in wiring:** `feature.src.js` wraps the (design, impl) pair via `runWithBacktrack` only when `PHASE_BUDGETS.backtrack > 0`. `bugfix`/`debug` wrap (research/root-cause, fix). Guarded so the default path is unchanged.

### Approach B (rejected): backtrack logic inside each workflow inline

Duplicate the re-run loop in `feature`/`bugfix`/`debug`. Rejected: copy-paste across 3+ workflows, drift risk, each needs its own tests for the same logic. The helper (A) centralizes it once.

### Why A

A isolates the new behavior in one ~30-line fragment + one additive field; default `budget=0` makes it a no-op until explicitly enabled; the trigger primitive (`backtrackEligible`) is independently testable. Matches the existing fragment-composition pattern (`runCI` is the precedent — a helper that wraps a phase loop).

## Affected files

- `src/fragments/run-phase.js` — add `backtrackEligible: true` to the exhausted return (1 line).
- `src/fragments/backtrack.js` — NEW: `runWithBacktrack` helper.
- `src/fragments/budgets.js` — add `backtrack: 0`.
- `src/workflows/feature.src.js` — opt-in wrap of design→impl; add `backtrack` to `@@USE`.
- `src/workflows/bugfix.src.js`, `src/workflows/debug.src.js` — opt-in wrap; `@@USE`.
- `tests/backtrack.test.js` — NEW.
- `src/fragments/CLAUDE.md` / `docs/architecture.md` — note the new fragment.

## API surface

```
runWithBacktrack(
  prevRunner: (feedback: string) => Promise<{ok, out, grade}>,
  curRunner:  () => Promise<{ok, out, grade, backtrackEligible?}>,
  opts: { budget?: number, label?: string }
) => Promise<{ok, out, grade, backtracks: number}>
```
`run-phase` return gains optional `backtrackEligible?: boolean` (only `true` on exhausted no-APPROVE).

## Blast-radius

- `runPhase` callers: every workflow + `tests/run-phase-*.test.js`. Change is an **added** return field — no caller reads it today, so no behavior change (verified: callers destructure `{ok, out, grade}`). New callers opt in via the helper.
- `runWithBacktrack`: new symbol, 0 existing callers.
- `PHASE_BUDGETS`: read across workflows; adding a key with default `0` is non-breaking.

## Error handling

- If `prevRunner` throws/returns `ok:false`, stop backtracking immediately and fall through to the existing `needs_human` handoff (don't mask the failure).
- Budget is a hard integer floor; a non-numeric/absent `backtrack` arg coerces to `0` (off).

## Rollback

Delete `src/fragments/backtrack.js`, drop the `backtrack` key from `budgets.js`, remove the `@@USE` + wrap lines, drop the `backtrackEligible` field, rebuild. No persisted state, no schema change, no migration.

## Failure scenarios (2+)

1. **Infinite design↔impl loop** — mitigated: `budget` strictly decrements per backtrack; default `0`; hard stop → existing handoff.
2. **Backtrack masks a real blocker** (e.g. tests genuinely can't pass) — mitigated: only triggers on exhausted-escalation `backtrackEligible`, bounded to `budget` attempts, then hands off to human exactly as today; GraderFeedback still persisted each attempt so `/improve` sees the pattern.
3. **Default-path regression** — mitigated: `budget=0` makes `runWithBacktrack` a pass-through; `tests/backtrack.test.js` asserts byte-equivalent behavior when off + all 245 existing tests stay green.

## Restraint (YAGNI)

One small fragment + one additive field + one budget key. No new schema, no new agent, no config UI, no per-phase registry. Default off → nothing changes until someone sets `backtrack=1`. Reuses the existing `runCI`-style helper pattern rather than inventing a phase-graph abstraction.

## Acceptance criteria

- `runWithBacktrack` with `budget=0` is behavior-identical to calling `curRunner()` directly (test).
- With `budget=1` and a `cur` that fails-then-succeeds-after-prev-rerun: re-runs prev once, then cur, returns `ok:true, backtracks:1` (test).
- With `budget=1` and `cur` that always fails: prev re-run once, cur retried once, returns `ok:false` → caller hands off (test).
- Default workflows (no `backtrack` arg) unchanged; 245 existing tests green; build import-free.
