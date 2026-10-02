#!/usr/bin/env bash
# PreToolUse gate — block human-facing writes until the humanizer skill has run.
#
# Covers Slack sends, Linear comments and status updates, Front replies, and the
# gh/glab commands that create or comment on a PR or MR. Everything else passes.
#
# The rule this enforces: anything another person reads is written in the operator's
# own voice, not model-shaped prose. Run the humanizer skill on the draft, then retry.
#
# Escape hatch: touch ~/.claude/.humanizer-off to disable the gate on this machine.
set -u

[ -f "$HOME/.claude/.humanizer-off" ] && exit 0

payload="$(cat 2>/dev/null || true)"
tool="$(printf '%s' "$payload" | jq -r '.tool_name // empty' 2>/dev/null || true)"
session="$(printf '%s' "$payload" | jq -r '.session_id // "nosession"' 2>/dev/null || echo nosession)"

gated=0
case "$tool" in
  Bash)
    cmd="$(printf '%s' "$payload" | jq -r '.tool_input.command // empty' 2>/dev/null || true)"
    # Anchor at a command position (start of line, or after a separator) so prose that
    # merely mentions one of these commands -- a heredoc, a doc edit, a git commit body --
    # does not trip the gate. Only an actual invocation does.
    if printf '%s' "$cmd" | grep -Eq '(^|[;&|(]|&&|\|\|)[[:space:]]*(gh[[:space:]]+(pr[[:space:]]+(create|edit|comment|review)|issue[[:space:]]+(create|comment))|glab[[:space:]]+mr[[:space:]]+(create|update|note))\b'; then
      gated=1
    elif printf '%s' "$cmd" | grep -Eq '(^|[;&|(]|&&|\|\|)[[:space:]]*gh[[:space:]]+api\b.*(/comments|/reviews)'; then
      gated=1
    fi
    ;;
  *slack_send_message*|*slack_schedule_message*|*slack_create_canvas*|*slack_update_canvas*|\
  *Linear__save_comment*|*Linear__save_status_update*|*Linear__save_document*|\
  *Front_MCP__send_message*|*Front_MCP__create_draft*|*Front_MCP__add_comment*|\
  *Notion__notion-create-comment*)
    gated=1
    ;;
esac

[ "$gated" = 1 ] || exit 0

marker="$HOME/.claude/.humanizer-ok-$session"
if [ -f "$marker" ]; then
  rm -f "$marker"
  exit 0
fi

cat <<'JSON'
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "Human-facing text: run the humanizer skill on this draft first, then retry this call. Humanizer strips model-shaped prose so the message reads like the operator wrote it -- no tables, no bold inline headers, no AI vocabulary, no generated-by footer. One humanizer run clears one post. Bypass for this machine: touch ~/.claude/.humanizer-off"
  }
}
JSON
exit 0
