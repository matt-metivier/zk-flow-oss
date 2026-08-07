# Beads — run memory & self-improvement signal

zk-flow uses **bd (beads)** as its memory layer, not as a human to-do list. A bead is
the durable spine of a workflow run: every phase writes typed, schema-shaped comments to
it, so a run can be resumed, audited, and mined for self-improvement long after the
Claude Code session ends.

> **Iron law:** run state lives in beads, never in the repo. Task artifacts
> (`research.md`, `design.md`, `solution.md`, `audit.json`) are scratch in the working
> directory; the bead is the source of truth. The rich prose of `research.md` /
> `design.md` is mirrored INTO the bead as `ResearchDoc` / `DesignDoc` comments (via
> `persistArtifact`) so a run survives `$TMPDIR` reaping. Reusable prose knowledge still
> goes to the vault.

## Architecture

- Issues live in a local **Dolt DB**. Sync uses `refs/dolt/data` on the git remote.
- `.beads/issues.jsonl` is a **passive export** of that DB — regenerated, **gitignored**,
  and NOT the sync mechanism. Do not commit it (see the recurring churn it caused before
  it was untracked).
- See https://github.com/gastownhall/beads/blob/main/docs/SYNC_CONCEPTS.md for details.

## The run bead

Each workflow run is anchored to one bead id, derived by `runBeadId(a)`
(`src/fragments/bead-run.js`) in this precedence:

| Input | Resulting id | Use |
|---|---|---|
| `bead=<id>` | the id, normalized to `[a-z0-9-]` | **Correlate run-1 ↔ run-2** across the design→impl seam, or resume |
| `pr=<url>` | `zk-flow-pr-<slug>` | finish-pr (no positional text) |
| positional text (`/feature add rate limiting`) | `zk-flow-add-rate-limiting` | normal slash-command use |
| `brief=<text>` (no positional) | `zk-flow-<brief-slug>` | programmatic/Workflow-tool invocation |
| nothing | `zk-flow-run` | fallback (avoid — it collides; pass `bead=` or a brief) |

**Always pass `bead=<id>` when resuming or chaining runs** so run-2 loads run-1's context.
Without a distinguishing input, runs collapse onto the generic `zk-flow-run` bead and
co-mingle their phase comments (this is what the now-closed `zk-flow-run` bead is — a
historical collision bucket from before the brief-slug fix).

## What each phase persists

`persistPhase(beadId, type, payload)` writes a typed comment after each phase. Persistence
is **load-bearing** — it throws on failure (a silent loss once cost the project its entire
bd history). Types you will see on a feature run:

| Type | Written by | Holds |
|---|---|---|
| `Research` | research phase | synthesis + evidence (JSON) |
| `ResearchDoc` | research phase | the full `$TMPDIR/research.md` prose (the doc the grader reads), attached via `persistArtifact` so a run is reconstructable from the bead alone. Soft / no-op if absent |
| `Discover` | discover phase | selected skills, vault paths, related beads |
| `Design` / `DesignGrade` | design phase | SQCA design + grader verdict (JSON) |
| `DesignDoc` | design phase | the full `$TMPDIR/design.md` prose, attached via `persistArtifact`. Soft / no-op if absent |
| `Impl` | impl phase | implementation result (files, commits, tests) |
| `CIPassed` / `CIFix` | ci loop | green status / re-run record |
| `GraderFeedback` | every grade gate | `{phase, iteration, verdict, weighted_score, findings[]}` — the self-improve signal `/improve` clusters over time |
| `ProofOfWork` | successful feature/small-feature completion | `{bead, branch, verdict, route, files_changed, commits, review, tests}` — one acceptance summary (Symphony "proof of work") so a human can sign off from a single bead comment instead of reading every phase |

The grade gate (`runPhase`) also records **escalation telemetry** (`escalated`,
`fromTier`, `toTier`) when a phase escalates a model tier after failing at its current tier.

## Run-bead lifecycle (open -> in_progress -> closed)

A run bead now transitions status automatically, so `bd ready` reflects only genuinely
open work and the daily digest's `open_loops` (which queries `bd list -s in_progress`)
is meaningful.

| Transition | When | Who | Helper |
|---|---|---|---|
| `open -> in_progress` | once, right after `runBeadId(a)` resolves (after input guards, before the first phase) | the workflow body | `claimRun(beadId)` (`bead-run.js`) |
| `in_progress -> closed` | once, immediately before the terminal `APPROVE` return (after `ProofOfWork` is persisted) | the workflow body | `closeRun(beadId, reason)` (`bead-run.js`) |

Wired into the full-lifecycle workflows: **feature, small-feature, refactor, finish-pr**. Both helpers
are **soft** (built on the `persistPhaseSoft` pattern) — a status transition that fails is logged,
never fatal, so it cannot abort an otherwise-successful run. `claimRun` is idempotent
(`bd update --claim` is a no-op if already claimed), so resuming a run (`bead=`, `startAt=impl`)
re-claims harmlessly.

**Non-terminal workflows (research, design) do NOT auto-close** — their bead is a handoff
artifact meant to be referenced by a downstream run via `bead=`, so it stays open by design.

## Durable memory (`bd remember`)

`GraderFeedback` is the per-run self-improve signal; **`bd remember` is the cross-session one**.
Memories written with `bd remember "<insight>" --key <stable-key>` are injected at every future
`bd prime`, so a recurring learning informs later discover/research/improve runs without being
re-derived. The `/improve` reflector distills up to 3 durable learnings per cycle (see
`prompts/phases/self-improvement.md` Part D); the workflow's distill step persists them via the
`bdRemember` helper (`bd-memory.js`). The read side — bounded/windowed retrieval into discover —
is tracked by bead `zk-flow-xj3` and consumes these via the `bdMemories(keyword)` helper.

Helpers in `bd-memory.js`: `bdClaim`, `bdClose`, `bdRemember`, `bdMemories` (shell-snippet
generators); their async, soft, agent-running wrappers `claimRun` / `closeRun` / `rememberInsight`
live in `bead-run.js`.

## Reading a run

```bash
bd show <bead-id>                 # overview + status
bd comments <bead-id>             # full phase trail (Discover, GraderFeedback, ...)
bd ready                          # available work
bd close <bead-id>                # archive a finished/obsolete bead
```

`bd comments` (not `bd show --with-messages`) is the reliable way to read back the typed
phase payloads.

## Self-improvement loop

`GraderFeedback` beads are the training signal for the `improve` workflow: it clusters
gaps by phase × rubric × skill across recent runs and proposes rubric/skill/schema
mutations. This only works if persistence succeeds on every run — which is why
`persistPhase` fails loud rather than swallowing errors.
