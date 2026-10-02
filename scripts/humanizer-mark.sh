#!/usr/bin/env bash
# PreToolUse(Skill) — record that the humanizer skill ran in this session.
#
# Pairs with humanizer-gate.sh, which refuses human-facing writes (Slack, PR/MR,
# Linear comments, Front replies) until this marker exists. The marker is consumed
# by the gate on the next allowed write, so one humanizer pass buys one post.
set -u

payload="$(cat 2>/dev/null || true)"
skill="$(printf '%s' "$payload" | jq -r '.tool_input.skill // .tool_input.name // empty' 2>/dev/null || true)"
session="$(printf '%s' "$payload" | jq -r '.session_id // "nosession"' 2>/dev/null || echo nosession)"

case "$skill" in
  *humanizer*) : > "$HOME/.claude/.humanizer-ok-$session" 2>/dev/null || true ;;
esac

exit 0
