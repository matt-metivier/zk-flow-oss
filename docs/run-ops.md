# Run ops

Two scripts for operating zk-flow runs at a higher level (Symphony-inspired).

## `scripts/run-cost.sh` — per-run cost

The workflow runtime writes one `agent-<id>.jsonl` per subagent (with usage per
message) plus an `agent-<id>.meta.json` (agentType). This script sums tokens by
model, applies Claude pricing, and prints total $ + per-model + per-agent-type
breakdowns. No deps.

```bash
scripts/run-cost.sh <transcript-dir>   # the "Transcript dir" the Workflow launch prints
scripts/run-cost.sh <runId>            # e.g. wf_8fd85f37-b9c (resolved under ~/.claude/projects)
scripts/run-cost.sh --json <dir|runId> # machine-readable
```

Pricing (per 1M tokens): opus-4-8 $5 in / $25 out; sonnet-4-6 $3 / $15; haiku-4-5
$1 / $5. Cache reads ~0.1x input; cache writes 1.25x (5m) / 2x (1h). Unknown
models are priced at the sonnet rate and flagged. Pairs with the `ProofOfWork`
bead artifact: proof-of-work shows *what shipped*, run-cost shows *what it cost*.

Because a workflow cannot read its own token usage at runtime (and nothing prints
its runId for you to paste in), the `ProofOfWork` bead carries a `cost_cmd` field:
a self-resolving, copy-paste-runnable command that finds the newest run's
transcript dir and reports its cost. Run it as-is to price the most recent run:

```bash
scripts/run-cost.sh "$(find ~/.claude/projects -type d -path '*subagents*' -name 'wf_*' | sort | tail -1)"
```

If you need an older run, pass that run's `wf_` runId (printed in the Workflow
launch output) to `run-cost.sh` directly instead.

## `scripts/zkflow-daemon.sh` — autonomous dispatcher (Symphony pattern)

Polls `bd ready`, maps each ready bead to a workflow (bug → `/debug`, else
`/feature`), and dispatches via headless Claude Code with bounded concurrency.
Workflows stop at a handoff/testing boundary and never merge, so the daemon
surfaces and drives work to the human seam — it does not land code.

```bash
scripts/zkflow-daemon.sh                       # DRY-RUN one pass (default — prints the plan, runs nothing)
scripts/zkflow-daemon.sh --execute             # dispatch ready beads, one pass
scripts/zkflow-daemon.sh --execute --loop 300  # poll every 300s
scripts/zkflow-daemon.sh --concurrency 1 --label auto   # scope + serialize
```

**Safety:** default is `--dry-run`; `--execute` is required to dispatch; bounded
by `--concurrency` (default 2); never calls `gh pr merge` / `glab mr merge`.
Scope with `--label <bd-label>` so it only picks up intended beads. Each
dispatched run correlates to its bead via `bead=<id>` and writes a `ProofOfWork`
comment on completion.

**Auto cost-report:** after the `--execute` dispatch pass finishes, the daemon
locates the newest workflow transcript dir and runs `run-cost.sh` on it, printing
the run cost inline. This is best-effort and shows the *newest* run only — under
`--concurrency` greater than 1 that is one of several concurrent runs, not the
pass total, so the output is labelled accordingly. In `--dry-run` the daemon only
announces the cost-report it *would* run (and the locator it would use); it
invokes nothing. If no transcript dir is found, it prints a skip line.

## `scripts/prune-worktrees.sh` — stale worktree cleanup

Worktrees under `.claude/worktrees/` (or wherever Claude Code creates them) are
left locked after non-success workflow exits (`needs_human`, `handoff`). The
workflow JS sandbox cannot run `git`, so this out-of-band script handles cleanup.

```bash
scripts/prune-worktrees.sh                    # prune stale zkflow/* worktrees
scripts/prune-worktrees.sh --dry-run          # print what would be removed, exit 0
STALE_MINUTES=30 scripts/prune-worktrees.sh  # custom staleness threshold (default: 60)
```

**Safety:** only removes worktrees on branches matching `zkflow/*`; runs
`git worktree prune` first (removes already-gone paths); never touches
`main`/`master`/`develop`; `--dry-run` makes no changes.

**Daemon integration:** `zkflow-daemon.sh` calls `prune_pass()` (which runs
this script) before every `one_pass()` — both in single-pass and `--loop`
modes. This ensures stale worktrees from the previous pass are cleaned up
before the next dispatch cycle.
