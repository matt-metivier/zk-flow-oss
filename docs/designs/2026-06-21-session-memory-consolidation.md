# Session memory consolidation

- **Date:** 2026-06-21
- **Status:** Proposed (awaiting review)
- **Author:** ih (matt) + Claude
- **Scope:** zk-flow memory capture + recall. One spec; tool-skill freshness and broad workflow consolidation are noted as follow-ups.

## Problem

The session -> bead -> recall loop is half-built. Audit (2026-06-21):

1. **Close-leak.** Only `feature`, `finish-pr`, `refactor`, `small-feature` call `closeRun`. `debug` writes `ProofOfWork` then never closes; `dashboard` and others never close either. Run beads pile up `open` (observed: stale open beads `/remember` keeps surfacing, including completed work like the minions uat-deploy fix).
2. **Recall blindness downstream.** `discover` + `research` read `related_beads` (`bd comments`) + `bd memories`. But `design.md` and `implementation.md` prompts never re-read prior beads/artifacts — forward handoff is in-memory only. Later phases are blind to prior work.
3. **Empty recall lane.** `bd remember` (the only lane auto-injected at every `bd prime`) is written ONLY by `/improve`'s distill step. `/improve` is manual and needs >=5 GraderFeedback events, so it rarely runs -> `bd remember` is empty in practice -> even the wired recall in discover/research finds nothing.
4. **Rollup not installed.** The `daily-accumulate.sh` Stop hook runs (tokenless), but the `daily-rollup.sh` launchd plist is not installed on this machine, so scratch never rolls into `DailyDigest` beads -> `/remember` finds zero digests ("start fresh" every day).

These compound: nothing closes, nothing distills, the rollup is off -> recall has nothing to pull.

## Goals

- Every lifecycle run closes its bead and distills durable insight in ONE call.
- Prior-run context reaches `design` and `implementation`, not just `research`.
- One recall implementation, reused by in-workflow phases AND `/remember`.
- `bd remember` actually accumulates, without colliding with `/improve`.
- The daily cross-machine floor (accumulate + rollup) actually runs.

## Non-goals (separate specs)

- Tool-index hygiene hooks; MOC auto-routing beyond what `discover` already does.
- `cgc` -> `codebase-memory-mcp` skill/hook rename (see Follow-ups).
- Broad workflow consolidation beyond the `bugfix` orphan (see Follow-ups).

## Design

One `memory` fragment (extend `src/fragments/bd-memory.js` + `bead-run.js`), three functions, woven into the workflow lifecycle. No new launchd/SessionStart LLM job (the earlier 3-layer capture plan is dropped in favor of capture-at-close).

### A. `recall({scope, beadId, keywords, date})` — the READ

Consolidates the lookups today scattered across `discover.md` prose into one reusable function. Returns a compact context block.

- `scope: 'task'` — `bd memories <keywords>` + `bd comments` of the top related beads + last relevant `DailyDigest` + `vault/Solutions/` matches. Called once at the discover/research entry of a lifecycle run; result persisted as a `RecalledContext` bead comment.
- `scope: 'daily'` — all-hosts `DailyDigest` beads for `date` (today-1 default). This is what `/remember` calls.

Same implementation, two scopes. `/remember` becomes a thin wrapper over `recall({scope:'daily'})`.

### B. `distillToMemory(beadId, {scope, existing})` — the shared distill

The distill logic that `/improve` already inlines, factored out and reused. Always: read existing (`bd memories`) first, emit <=3 insights, keyed kebab-case, dedup by key, soft (never aborts the run).

Two key-namespaced lanes so the two callers never collide:

- **`process:<slug>`** — written by `/improve`. Cross-run meta gaps (phase x rubric x skill). "the harness keeps doing X wrong."
- **`domain:<repo>:<slug>`** — written by `closeAndDistill`. Operational/domain facts from one successful run. "minions imageRegistry default is localhost:5001, must override."

`/improve`'s existing distill block is refactored to call `distillToMemory(beadId, {scope:'process'})`. No behavior change for `/improve` beyond the shared code path + explicit key namespace.

### C. `closeAndDistill(beadId, reason, artifacts)` — the WRITE at terminal success

One call replacing the inconsistent `persistSolution` + (sometimes) `closeRun`:

1. `distillToMemory(beadId, {scope:'domain'})` -> populates the recall lane.
2. `persistSolution(...)` (vault, unchanged).
3. `closeRun(beadId, reason)` (fixes the close-leak).

All steps soft; a failure logs and never swallows the run verdict.

### D. Phase-prompt injection

Inject a `## Recalled Context` block (sourced from the persisted `RecalledContext`) into the shared phase prompts `research.md`, `design.md`, `implementation.md`, `testing.md`. Changed once; all lifecycle workflows inherit because they `loadPhasePrompt` the same files. Fixes recall blindness (#2).

### E. Floor (keep + install)

- `daily-accumulate.sh` Stop hook: unchanged (tokenless floor for ad-hoc/non-workflow sessions).
- `daily-rollup.sh`: INSTALL the launchd plist (`daily-rollup.sh --install`). Fixes #4. Optionally enrich `DailyDigest` schema with `files_touched` (from `git diff --name-only` since midnight), deterministic.

## Workflow wiring map

| Workflow | recall (task) at entry | closeAndDistill at terminal |
|---|---|---|
| `feature` | yes | yes (replaces existing close) |
| `small-feature` | yes | yes |
| `debug` | yes | yes (**currently leaks — fix**) |
| `refactor` | yes | yes |
| `research` | yes | n/a (stops; no terminal close) |
| `design` | yes | n/a (seam; run continues) |
| dashboard / finish-pr / critique / grill / review / eval-tool | n/a (no research/impl phase; finish-pr loads its own context) | unchanged |

`/remember` and `/improve` consume the memory fragment but are not lifecycle-close workflows.

## Data flow

```
turn -> daily-accumulate (free, tokenless)
  -> [idle] launchd rollup -> DailyDigest bead (deterministic)
workflow start -> recall(task) -> RecalledContext comment
  -> research/design/impl/testing prompts get ## Recalled Context  (one read, reused)
  -> per-phase persistPhase (unchanged)
  -> terminal success -> closeAndDistill: bd remember (domain:) + persistSolution + closeRun
/improve (manual, >=5 feedback events) -> distillToMemory (process:)
bd remember -- synced via refs/dolt/data -- injected at every future bd prime + read by next recall()
/remember -> recall(daily) for cross-machine handoff
```

## Schemas

- `schemas/memory-insight.json` — `{ insights: [{ key, insight, scope }], narrative }` for the distill structured output. Reused by `closeAndDistill` and `/improve`.

## Consolidation / simplification (in this spec)

- DRY the distill logic: `/improve` and `closeAndDistill` share `distillToMemory` instead of two copies.
- Unify recall: discover's scattered `bd`/MoC/vault/Solutions reads and `/remember`'s daily load become one `recall()` with two scopes.

## Docs + mermaid

Update and verify:

- Mermaid charts (add recall node at start, closeAndDistill node at end): `feature.md`, `small-feature.md`, `debug.md`, `refactor.md`; partial for `research.md`, `design.md`.
- `improve.md`: show the shared distill + the `process:`/`domain:` lane split.
- `architecture.md`: Memory section + (no catalog change — no new/renamed workflow here).
- `docs/beads.md`: document the two `bd remember` lanes, `recall`, `closeAndDistill`.
- `docs/onboarding/6-daily-digest.md`: rollup `--install` step.

Verification: extend `tests/doc-accuracy.test.js` to assert each changed lifecycle doc mentions `recall` and `closeAndDistill`. Full mermaid render (via `mmdc`) is a heavier dev dependency — default to manual eyeball unless we adopt the dep.

## Testing

- Build-test (grep-style, like existing build validity tests): every workflow that writes `ProofOfWork` also calls `closeAndDistill`.
- `recall()` returns a context block; the 4 shared phase prompts contain the `## Recalled Context` injection point.
- `distillToMemory`: stub the distill agent -> assert keyed `bd remember`, dedup against existing, cap 3, correct key namespace per scope.
- Bead round-trips to `closed` status after a lifecycle terminal.
- `schemas/memory-insight.json` valid draft-07.
- `daily-rollup.sh --install` idempotent (temp HOME).

## Rollout / migration

- Existing stale-open run beads are not retroactively closed by this change; close them manually or via a one-off sweep (out of scope).
- `bd remember` starts empty; lanes populate as lifecycle runs and `/improve` cycles execute.

## Follow-ups (out of scope, candidate next specs)

1. ~~Retire the `bugfix` orphan.~~ **Done.** `/bugfix` was already consolidated into `/small-feature` in commit `f30f3aa` (source `bugfix.src.js` deleted). The only residue was a stale gitignored build artifact `.claude/workflows/bugfix.js` left on disk (which also produced a phantom `/bugfix` skill) — removed 2026-06-21. No spec work remains.
2. **`cgc` -> `codebase-memory-mcp` rename.** The PostToolUse hook (`cgc index`), `~/.claude/CLAUDE.md`, and ~15 `zk-artifacts/skills/**` files still reference `cgc`/CodeGraphContext while routing already renamed it. Tool-skill freshness sweep across zk-artifacts.
3. Tool-index hygiene hooks; MOC auto-routing.
