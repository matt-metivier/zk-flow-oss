#!/usr/bin/env bash
# zk-flow daily-digest: Stop-hook accumulator.
# Tokenless, never blocks the turn, exits 0 on any input (incl. garbage).
# Appends ONE compact JSON event per turn to a host+date scratch log and touches
# a last-activity marker. Reads the Stop hook stdin JSON: .cwd, .last_assistant_message
# (a direct Stop field — transcript_path is unreliable for resumed/forked sessions).
# NO LLM. The heavy summarization happens later in daily-rollup.sh.

HOST=$(hostname -s | tr 'A-Z' 'a-z')
DIR=${ZKFLOW_DAILY_DIR:-$HOME/.local/share/zk-flow/daily}
mkdir -p "$DIR" 2>/dev/null
DATE=$(date +%Y%m%d)
LOG="$DIR/$HOST-$DATE.jsonl"

payload=$(cat 2>/dev/null || true)

cwd=""; msg=""
if command -v jq >/dev/null 2>&1 && [ -n "$payload" ]; then
  cwd=$(printf '%s' "$payload" | jq -r '.cwd // empty' 2>/dev/null || true)
  msg=$(printf '%s' "$payload" | jq -r '.last_assistant_message // empty' 2>/dev/null || true)
fi
[ -n "$cwd" ] || cwd=$(pwd 2>/dev/null || echo "")
# keep the scratch small — a snippet is enough to reconstruct the turn next day
msg=$(printf '%s' "$msg" | head -c 200)

# bead-if-derivable: a zkflow/<bead> run branch checked out in cwd
bead=""
if [ -n "$cwd" ] && git -C "$cwd" rev-parse --abbrev-ref HEAD >/dev/null 2>&1; then
  br=$(git -C "$cwd" rev-parse --abbrev-ref HEAD 2>/dev/null || true)
  case "$br" in zkflow/*) bead="${br#zkflow/}" ;; esac
fi

ts=$(date +%s)
if command -v jq >/dev/null 2>&1; then
  jq -cn --arg cwd "$cwd" --arg prompt "$msg" --arg bead "$bead" --argjson ts "$ts" \
    '{cwd:$cwd,prompt:$prompt,bead:$bead,ts:$ts}' >> "$LOG" 2>/dev/null || true
else
  # jq absent: write a minimal line (prompt omitted to avoid unsafe escaping)
  printf '{"cwd":"%s","prompt":"","bead":"%s","ts":%s}\n' "$cwd" "$bead" "$ts" >> "$LOG" 2>/dev/null || true
fi
touch "$DIR/$HOST.last-activity" 2>/dev/null || true
exit 0
