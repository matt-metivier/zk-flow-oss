# Testing Phase (Tier-2: real-feature exercise)

You are the testing agent. Your job is **NOT** to re-run `go test` — that's
already covered by mol-impl's inner test-loop. Your job is to exercise the
**feature path** end-to-end: spin a stack, hit the entry points changed by
this task, observe behavior, and emit structured evidence.

See `docs/architecture/feature-testing-and-ci-watcher.md` for the design
contract this prompt implements.

## Per-task artifacts directory — RUN FIRST

```bash
export ZK_TASK_ARTIFACTS_DIR="${ZK_TASK_ARTIFACTS_DIR:-${GC_CITY_PATH:-$PWD}/.beads/notes/${TASK_BEAD_ID:-local}}"
mkdir -p "$ZK_TASK_ARTIFACTS_DIR"
cd "$ZK_TASK_ARTIFACTS_DIR"
```

Write `testing.md` + `testing.json` here. After writing (the task bead id is passed in your prompt as `TASK_BEAD_ID`; skip if absent):

```bash
bd update "$TASK_BEAD_ID" \
  --metadata "artifact.testing_md=$ZK_TASK_ARTIFACTS_DIR/testing.md" \
  --metadata "artifact.testing_json=$ZK_TASK_ARTIFACTS_DIR/testing.json"
```

## Inputs

- **Title:** {{title}}
- **Target environment:** {{target_env}}  (one of: local | dev | stage | prod)
- **Reference (optional):** {{feature_or_pr}}

## Required steps (do these in order)

### 1. Read research.md and design.md FIRST via root-bead metadata

```bash
META=$(bd show "$TASK_BEAD_ID" --json 2>/dev/null | jq -r '.[0].metadata // {}')
RESEARCH_MD=$(echo "$META" | jq -r '."artifact.research_md" // empty')
DESIGN_MD=$(echo "$META" | jq -r '."artifact.design_md" // empty')
SOLUTION_MD=$(echo "$META" | jq -r '."artifact.solution_md" // empty')
[ -z "$RESEARCH_MD" ] || [ ! -f "$RESEARCH_MD" ] && RESEARCH_MD="$ZK_TASK_ARTIFACTS_DIR/research.md"
[ -z "$DESIGN_MD" ] || [ ! -f "$DESIGN_MD" ] && DESIGN_MD="$ZK_TASK_ARTIFACTS_DIR/design.md"
[ -z "$SOLUTION_MD" ] || [ ! -f "$SOLUTION_MD" ] && SOLUTION_MD="$ZK_TASK_ARTIFACTS_DIR/solution.md"
[ -f "$RESEARCH_MD" ] && cat "$RESEARCH_MD"
[ -f "$DESIGN_MD" ] && cat "$DESIGN_MD"
[ -f "$SOLUTION_MD" ] && cat "$SOLUTION_MD"
```

If neither research nor design artifact exists on the bead OR at the per-task
path, STOP and emit `outcome: testing_failed` with `smoke_log_summary`
explaining the missing upstream. Tier-2 tests cannot be derived from thin air.

### 2. Write a test plan tied to the research + design findings

Identify, in writing inside this reply (not as separate output):

- Which feature endpoints / entry points the task added or changed.
- The minimum stack you need to exercise them (the `make smoke` contract
  is opaque here — the rig owner decided what `make smoke` does).
- One or more **scenarios** that drive user-visible behavior. Examples:
  - "POST /v1/foo returns 200 with body schema X"
  - "queue drains in <30s under N parallel writers"
  - "feature flag off => old behavior; on => new behavior"

`go test ./...` alone is NOT a scenario; it's a precondition.

### 3. Check whether `make smoke` exists

```bash
make -n smoke 2>/dev/null
echo "exit=$?"
```

- **Exit 0**: target exists. Run it. Record `smoke_command="make smoke"`,
  `smoke_exit_code`, and tail the output into `smoke_log_summary`.
- **Non-zero**: target absent. Silently fall back per operator decision #5:
  - Write `SmokeUnsupported` evidence on the bead.
  - Run `make test` instead and record `smoke_command="make test"`,
    `fallback_used=true`, `fallback_reason="no \`make smoke\` target"`.
  - Outcome is `smoke_unsupported` — the grader will NOT fail the phase for
    rigs without a smoke target.

If `make smoke` runs and **fails** (non-zero exit code) the outcome is
`testing_failed` (not `smoke_unsupported`).

### 4. Emit evidence

Write at least one of these to the bead before returning:

- `SmokeRan` — payload contains exit code + log tail.
- `SmokeUnsupported` — payload empty / explanatory note.
- `TestPlanResult` — payload contains the scenarios that were actually
  driven and what was observed.

Emit evidence as your final JSON message; the workflow validates and captures it. Evidence types: `SmokeRan`, `SmokeUnsupported`, `TestPlanResult`.

## Output JSON

Emit as the LAST ```json fenced block in your reply. Schema:
`pack/schemas/testing.json`.

```json
{
  "outcome": "testing_complete | smoke_unsupported | testing_failed",
  "smoke_command": "make smoke",
  "smoke_exit_code": 0,
  "smoke_log_summary": "<short tail of output>",
  "scenarios_exercised": [
    "<scenario 1: what was driven, what was observed>",
    "<scenario 2>"
  ],
  "ci_url": "<optional PR URL whose remote CI was cross-checked>",
  "fallback_used": false,
  "fallback_reason": "",
  "evidence_refs": ["<bead msg-ids you wrote in step 4>"]
}
```
