#!/usr/bin/env bash
# zkflow-daemon.sh — Symphony-style autonomous dispatcher over the bd board.
#
# Polls `bd ready`, maps each ready bead to a workflow (bug -> /debug, else
# /feature), and dispatches it via headless Claude Code with bounded
# concurrency. zk-flow workflows stop at a handoff/testing boundary and never
# merge, so this never lands code on its own — it surfaces work, runs the
# lifecycle to the human seam, and writes a ProofOfWork bead per run.
#
# SAFETY (this auto-runs full workflows — read before --execute):
#   - DEFAULT IS --dry-run: prints the dispatch plan and exits. Nothing runs.
#   - --execute is required to actually dispatch. Bounded by --concurrency (2).
#   - It never calls `gh pr merge` / `glab mr merge`. Workflows stop at handoff.
#   - Pin scope with --label <bd-label> so it only picks up intended beads.
#
# Usage:
#   scripts/zkflow-daemon.sh                      # dry-run one pass (default)
#   scripts/zkflow-daemon.sh --execute            # dispatch ready beads, one pass
#   scripts/zkflow-daemon.sh --execute --loop 300 # poll every 300s
#   scripts/zkflow-daemon.sh --concurrency 1 --label auto
#
# Test/override hook: set ZKFLOW_BD_READY to a JSON array of {id,title,labels?}
# to bypass `bd ready` (used by tests; no bd required).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PRUNE_SCRIPT="${SCRIPT_DIR}/prune-worktrees.sh"
COST_SCRIPT="${SCRIPT_DIR}/run-cost.sh"
# Locator for the just-finished run's transcript dir. The transcript dir sits two
# levels below ~/.claude/projects (a session-UUID segment), so mirror run-cost.sh's
# depth-agnostic `find -path '*subagents*'` rather than a fixed-depth glob (the
# one-wildcard glob matched zero dirs). Newest dir = best-effort attribution.
COST_LOCATOR="find \"\$HOME/.claude/projects\" -type d -path '*subagents*' -name 'wf_*' 2>/dev/null | sort | tail -1"

EXECUTE=0; LOOP=0; CONCURRENCY=2; LABEL=""; MAX_TURNS=40
while [ $# -gt 0 ]; do
  case "$1" in
    --execute) EXECUTE=1 ;;
    --loop) LOOP="${2:-300}"; shift ;;
    --concurrency) CONCURRENCY="${2:-2}"; shift ;;
    --label) LABEL="${2:-}"; shift ;;
    --max-turns) MAX_TURNS="${2:-40}"; shift ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
  shift
done

command -v node >/dev/null || { echo "need: node" >&2; exit 1; }

# Map a bead -> workflow command. Pure, testable. Bug-ish title/label -> /debug.
plan_dispatch() {
  ZKFLOW_LABEL="$LABEL" ZKFLOW_MAXT="$MAX_TURNS" node <<'NODE'
const fs = require('fs');
const label = process.env.ZKFLOW_LABEL || '';
const maxt = process.env.ZKFLOW_MAXT || '40';
let beads;
if (process.env.ZKFLOW_BD_READY) {
  beads = JSON.parse(process.env.ZKFLOW_BD_READY);
} else {
  beads = JSON.parse(fs.readFileSync(0, 'utf8') || '[]');
}
const out = [];
for (const b of beads) {
  if (label && !((b.labels || []).includes(label))) continue;
  const t = (b.title || '').toLowerCase();
  const isBug = (b.type === 'bug') || (b.labels || []).includes('bug') || /\b(bug|fix|broken|regression|error|fails?)\b/.test(t);
  const wf = isBug ? 'debug' : 'feature';
  // bead= correlates the run to this bead; brief carries the title.
  const cmd = `/${wf} bead=${b.id} brief=${JSON.stringify(b.title || b.id)}`;
  out.push({ id: b.id, workflow: wf, command: cmd, headless: `claude --headless --max-turns ${maxt} ${JSON.stringify(cmd)}` });
}
process.stdout.write(JSON.stringify(out));
NODE
}

prune_pass() {
  if [ -x "$PRUNE_SCRIPT" ]; then
    "$PRUNE_SCRIPT" || true
  fi
}

one_pass() {
  local ready_json
  if [ -n "${ZKFLOW_BD_READY:-}" ]; then ready_json=""; else
    ready_json="$(bd ready --json 2>/dev/null || echo '[]')"
  fi
  local plan
  plan="$(printf '%s' "$ready_json" | plan_dispatch)"
  local n; n="$(printf '%s' "$plan" | node -e "process.stdout.write(String(JSON.parse(require('fs').readFileSync(0,'utf8')).length))")"
  echo "ready beads to dispatch: $n (concurrency=$CONCURRENCY, execute=$EXECUTE)"
  [ "$n" = "0" ] && return 0

  # Emit the plan
  printf '%s' "$plan" | node -e "JSON.parse(require('fs').readFileSync(0,'utf8')).forEach(d=>console.log('  ['+d.workflow+'] '+d.id+' -> '+d.command))"

  if [ "$EXECUTE" != "1" ]; then
    echo "(dry-run — nothing dispatched; pass --execute to run)"
    echo "(dry-run — WOULD cost-report the newest run via: ${COST_LOCATOR})"
    return 0
  fi

  # Dispatch with bounded concurrency. Never merges — workflows stop at the seam.
  printf '%s' "$plan" | node -e "process.stdout.write(JSON.parse(require('fs').readFileSync(0,'utf8')).map(d=>d.headless).join('\n'))" \
    | xargs -P "$CONCURRENCY" -I {} sh -c 'echo "dispatch: {}"; {}'

  # Cost-report the just-finished run, best-effort. The workflow cannot read its
  # own token usage, so we locate the newest transcript dir and hand it to
  # run-cost.sh. Under set -euo pipefail an empty glob yields an empty string at
  # exit 0, so the explicit [ -n ] guard — not `|| true` alone — produces the skip.
  if [ -x "$COST_SCRIPT" ]; then
    local cost_dir; cost_dir="$(eval "$COST_LOCATOR")"
    if [ -n "$cost_dir" ]; then
      echo "cost-report (showing newest; partial under -P>1):"
      "$COST_SCRIPT" "$cost_dir" || true
    else
      echo "cost-report: no transcript dir found (skipped)"
    fi
  fi
}

if [ "$LOOP" -gt 0 ]; then
  echo "daemon: polling every ${LOOP}s (Ctrl-C to stop)"
  while true; do prune_pass; one_pass; sleep "$LOOP"; done
else
  prune_pass
  one_pass
fi
