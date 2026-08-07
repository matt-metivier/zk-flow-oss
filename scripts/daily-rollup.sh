#!/usr/bin/env bash
# zk-flow daily-digest: idle-debounced deterministic rollup. Run by a launchd timer.
# Guards (all must pass): idle (last-activity older than ZKFLOW_IDLE_HOURS, default 2h),
# dirty (scratch newer than the last-rollup marker), once-per-day. On pass it builds a
# DETERMINISTIC DailyDigest (no LLM) and writes a host-scoped bead that rides zk-flow's
# EXISTING git-hook bead sync (refs/dolt/data) — NO explicit `bd dolt push` (unsupported
# without a Dolt remote + creds). `--install` writes+loads the launchd plist and exits.

HOST=$(hostname -s | tr 'A-Z' 'a-z')
DIR=${ZKFLOW_DAILY_DIR:-$HOME/.local/share/zk-flow/daily}
ZK=${ZK_FLOW_DIR:-$HOME/dev/zk-flow}
IDLE_HOURS=${ZKFLOW_IDLE_HOURS:-2}
DATE=$(date +%Y%m%d)
mkdir -p "$DIR" 2>/dev/null

# --- --install: write launchd plist + (re)load, then exit ---
if [ "${1:-}" = "--install" ]; then
  PLIST="$HOME/Library/LaunchAgents/com.zk-flow.daily-rollup.plist"
  SELF="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
  # launchd does not read your shell profile: its default PATH is
  # /usr/bin:/bin:/usr/sbin:/sbin, which has no Homebrew. bd/jq/npx all live there,
  # every bd call in this script is output-suppressed, and the net effect was a timer
  # that ran hourly for seven weeks and wrote nothing. Pin the real dirs.
  LAUNCHD_PATH="/usr/bin:/bin:/usr/sbin:/sbin"
  for _p in /opt/homebrew/bin /opt/homebrew/sbin /usr/local/bin "$HOME/.local/bin"; do
    [ -d "$_p" ] && LAUNCHD_PATH="$_p:$LAUNCHD_PATH"
  done
  for _tool in bd jq npx; do
    _dir="$(dirname "$(command -v "$_tool" 2>/dev/null || echo /nonexistent/x)")"
    case ":$LAUNCHD_PATH:" in *":$_dir:"*) ;; *) [ -d "$_dir" ] && LAUNCHD_PATH="$_dir:$LAUNCHD_PATH" ;; esac
  done
  mkdir -p "$HOME/Library/LaunchAgents" 2>/dev/null
  cat > "$PLIST" <<PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.zk-flow.daily-rollup</string>
  <key>ProgramArguments</key><array><string>$SELF</string></array>
  <key>StartInterval</key><integer>3600</integer>
  <key>EnvironmentVariables</key><dict>
    <key>ZKFLOW_DAILY_DIR</key><string>$DIR</string>
    <key>ZK_FLOW_DIR</key><string>$ZK</string>
    <key>ZKFLOW_IDLE_HOURS</key><string>$IDLE_HOURS</string>
    <key>BEADS_DIR</key><string>${BEADS_DIR:-$ZK/.beads}</string>
    <key>PATH</key><string>$LAUNCHD_PATH</string>
  </dict>
  <key>StandardOutPath</key><string>$DIR/rollup.log</string>
  <key>StandardErrorPath</key><string>$DIR/rollup.log</string>
  <key>RunAtLoad</key><false/>
</dict></plist>
PLISTEOF
  launchctl unload "$PLIST" 2>/dev/null || true
  launchctl load "$PLIST" 2>/dev/null || true
  echo "installed: $PLIST (StartInterval 3600, idle ${IDLE_HOURS}h, dir $DIR)"
  echo "  PATH=$LAUNCHD_PATH"
  echo "  BEADS_DIR=${BEADS_DIR:-$ZK/.beads}"
  echo "  log=$DIR/rollup.log"
  exit 0
fi

LOG="$DIR/$HOST-$DATE.jsonl"
ACT="$DIR/$HOST.last-activity"
RMARK="$DIR/$HOST.last-rollup"
RDATE="$DIR/$HOST.last-rollup-date"

[ -f "$LOG" ] || { echo "rollup: no scratch for $HOST-$DATE"; exit 0; }
[ -f "$ACT" ] || { echo "rollup: no activity marker"; exit 0; }

# idle guard
now=$(date +%s)
act=$(stat -c %Y "$ACT" 2>/dev/null || stat -f %m "$ACT" 2>/dev/null || echo 0)
case "$act" in (*[!0-9]*|'') act=0;; esac
if [ $(( now - act )) -lt $(( IDLE_HOURS * 3600 )) ]; then echo "rollup: not idle yet"; exit 0; fi

# once-per-day guard
if [ -f "$RDATE" ] && [ "$(cat "$RDATE" 2>/dev/null)" = "$DATE" ]; then echo "rollup: already rolled $DATE"; exit 0; fi

# dirty guard (scratch must be newer than the last rollup marker)
if [ -f "$RMARK" ] && [ ! "$LOG" -nt "$RMARK" ]; then echo "rollup: no new activity since last rollup"; exit 0; fi

command -v jq >/dev/null 2>&1 || { echo "rollup: jq required (PATH=$PATH)" >&2; exit 0; }
# The original failure mode: under launchd, bd was absent from PATH and every bd call
# was >/dev/null, so the rollup exited 0 having written nothing, hourly, for weeks.
command -v bd >/dev/null 2>&1 || { echo "rollup: FAIL bd not on PATH ($PATH) — reinstall with scripts/daily-rollup.sh --install" >&2; exit 0; }

# --- deterministic digest (no LLM) ---
threads=$(jq -s 'group_by(.cwd) | map({cwd: .[0].cwd, beads: ([.[].bead] | map(select(. != "")) | unique)})' "$LOG" 2>/dev/null || echo '[]')
beads_touched=$(jq -s '[.[].bead] | map(select(. != "")) | unique' "$LOG" 2>/dev/null || echo '[]')
commits=$(cd "$ZK" 2>/dev/null && git log --since=midnight --pretty=format:'%h %s' 2>/dev/null | jq -R -s 'split("\n") | map(select(length>0))' 2>/dev/null || echo '[]')
open_loops=$(cd "$ZK" 2>/dev/null && bd list -s in_progress --json 2>/dev/null | jq '[.[] | {id, title}]' 2>/dev/null || echo '[]')

digest=$(jq -cn \
  --argjson threads "${threads:-[]}" \
  --argjson beads_touched "${beads_touched:-[]}" \
  --argjson commits "${commits:-[]}" \
  --argjson open_loops "${open_loops:-[]}" \
  --arg host "$HOST" --arg date "$DATE" \
  '{threads:$threads,beads_touched:$beads_touched,commits:$commits,open_loops:$open_loops,host:$host,date:$date}' 2>/dev/null) || { echo "rollup: digest build failed" >&2; exit 0; }

BEAD="zk-flow-daily-$HOST-$DATE"
cd "$ZK" || { echo "rollup: cannot cd $ZK" >&2; exit 0; }
bd show "$BEAD" >/dev/null 2>&1 || bd create "zk-flow daily digest: $HOST $DATE" --id "$BEAD" -t task -l daily-digest >/dev/null 2>&1
printf 'DailyDigest: %s\n' "$digest" | bd comment "$BEAD" --stdin >/dev/null 2>&1

# round-trip verify (persistence failures must be loud, never silent)
if bd comments "$BEAD" 2>/dev/null | grep -q 'DailyDigest:'; then
  date +%s > "$RMARK"; echo "$DATE" > "$RDATE"
  echo "rollup: wrote $BEAD (rides existing git-hook bead sync)"
  # background tool refresh: cbm re-index all sibling repos so graph queries stay
  # current after a day of edits. fire-and-forget — failures are silent.
  if command -v npx >/dev/null 2>&1; then
    ZK_PARENT="$(dirname "$ZK")"
    _n=0
    for _d in "$ZK_PARENT"/*/; do
      [ -d "${_d}.git" ] || continue
      npx --yes codebase-memory-mcp cli index_repository "{\"repo_path\":\"${_d%/}\"}" >/dev/null 2>&1 &
      _n=$((_n+1))
    done
    echo "rollup: cbm re-index queued for $_n repos (background)"
  fi
else
  echo "rollup: WARN digest round-trip verify failed for $BEAD" >&2
fi

# tool updates: brew (rtk, beads) + npm global (repomix)
# context-mode + caveman update via /ctx-upgrade and /plugin update inside a session
if command -v brew >/dev/null 2>&1; then
  brew upgrade --quiet rtk beads 2>/dev/null | grep -E "==>|already installed" || true
fi
if command -v npm >/dev/null 2>&1; then
  npm update -g repomix >/dev/null 2>&1 || true
fi

exit 0
