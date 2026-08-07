#!/usr/bin/env bash
# zk-flow /improve nudge — Stop-hook accumulator.
# Tokenless, never blocks the turn, exits 0 on any input (incl. garbage).
# Counts COMPLETED zk-flow workflow runs (a zkflow/<bead> branch checked out in
# the turn's cwd, same signal daily-accumulate uses) and, once THRESHOLD runs have
# accumulated since the last nudge, prints a one-line suggestion to run /improve,
# then resets the counter. It SUGGESTS only — never auto-runs (no surprise token
# spend; /improve stages a branch and never merges anyway).
#   ZKFLOW_IMPROVE_THRESHOLD : runs between nudges (default 5, matches /improve's
#                              own min-feedback floor).
set -uo pipefail

THRESHOLD="${ZKFLOW_IMPROVE_THRESHOLD:-5}"
DIR="${ZKFLOW_STATE_DIR:-$HOME/.local/share/zk-flow}"
COUNTER="$DIR/improve-runs-since-nudge"
mkdir -p "$DIR" 2>/dev/null

payload=$(cat 2>/dev/null || true)

# Resolve cwd from the Stop payload (fallback to $PWD).
cwd=""
if command -v jq >/dev/null 2>&1 && [ -n "$payload" ]; then
  cwd=$(printf '%s' "$payload" | jq -r '.cwd // empty' 2>/dev/null || true)
fi
[ -n "$cwd" ] || cwd=$(pwd 2>/dev/null || echo "")

# A completed workflow run leaves the cwd on a zkflow/<bead> branch.
completed=0
if [ -n "$cwd" ] && git -C "$cwd" rev-parse --abbrev-ref HEAD >/dev/null 2>&1; then
  br=$(git -C "$cwd" rev-parse --abbrev-ref HEAD 2>/dev/null || true)
  case "$br" in zkflow/*) completed=1 ;; esac
fi
[ "$completed" = "1" ] || exit 0   # nothing to count this turn

# Increment the counter.
n=0; [ -f "$COUNTER" ] && n=$(cat "$COUNTER" 2>/dev/null || echo 0)
case "$n" in ''|*[!0-9]*) n=0 ;; esac
n=$((n + 1))

if [ "$n" -ge "$THRESHOLD" ]; then
  printf '0' > "$COUNTER" 2>/dev/null || true
  echo "[zk-flow] ${n} workflow runs completed since the last /improve. Consider running /improve to cluster their GraderFeedback into rubric/skill mutations (stages a branch; never merges)."
else
  printf '%s' "$n" > "$COUNTER" 2>/dev/null || true
fi
exit 0
