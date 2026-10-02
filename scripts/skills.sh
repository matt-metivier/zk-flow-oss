#!/usr/bin/env bash
# One entry point for skill registration.
#   skills.sh register   regenerate CATALOG.md, relink ~/.claude/skills, verify both
#   skills.sh list       every skill this host can load: flat /zk-<name>, catalog id, linked?
#   skills.sh check      exit 1 if the catalog or links are stale, or the host has no mr-conventions standard
set -uo pipefail
ZK_FLOW_DIR="${ZK_FLOW_DIR:-$HOME/dev/zk-flow}"
ZK_ARTIFACTS_DIR="${ZK_ARTIFACTS_DIR:-$HOME/dev/zk-artifacts}"
GEN="$ZK_ARTIFACTS_DIR/scripts/gen-skill-catalog.sh"
INSTALL="$ZK_FLOW_DIR/scripts/install-skills.sh"

host="$(cd "$ZK_FLOW_DIR" 2>/dev/null && bd config get host 2>/dev/null | tr -d '[:space:]')"
case "$host" in *notset*|"") host="${ZK_HOST_ALIAS:-$(hostname -s)}" ;; esac
standard="$ZK_ARTIFACTS_DIR/skills/agent/machines/$host/mr-conventions/SKILL.md"

check_standard() {
  if [ -f "$standard" ]; then
    echo "OK   host review standard: agent/machines/$host/mr-conventions"
  else
    echo "WARN host '$host' has no review standard -> create skills/agent/machines/$host/mr-conventions/ from skills/agent/scaffolding/mr-conventions-template.md"
    return 1
  fi
}

case "${1:-}" in
  register)
    bash "$GEN" || exit 1
    bash "$INSTALL" || exit 1
    bash "$GEN" --check && bash "$INSTALL" --check
    check_standard || true
    ;;
  list)
    python3 "$ZK_FLOW_DIR/scripts/skill-flat-names.py" "$ZK_ARTIFACTS_DIR/skills/CATALOG.md" host "$host" |
      while IFS=$'\t' read -r name sid; do
        [ -e "$HOME/.claude/skills/zk-$name/SKILL.md" ] && mark=linked || mark=MISSING
        printf '%-8s /zk-%-34s %s\n' "$mark" "$name" "$sid"
      done
    ;;
  check)
    rc=0
    bash "$GEN" --check || rc=1
    bash "$INSTALL" --check || rc=1
    check_standard || rc=1
    exit "$rc"
    ;;
  *)
    sed -n '2,5p' "$0" | sed 's/^# \{0,1\}//'
    exit 2
    ;;
esac
