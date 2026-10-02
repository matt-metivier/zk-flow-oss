#!/usr/bin/env bash
# Print skills/CATALOG.md scoped to THIS machine.
#
# CATALOG.md is committed and shared across every zk-flow host, so it lists
# `agent/machines/<alias>/...` ids for machines other than this one. Those dirs are
# symlinks into a repo that only exists on the owning box (n/nebo/* -> ~/dev/nebo),
# so discover selecting one yields a skill that cannot be rendered here.
#
# Drops other machines' agent skills and the archive; everything else passes through.
# Same rule as scripts/skill-flat-names.py select(), which scopes ~/.claude/skills.
#
# Usage: catalog-for-host.sh [alias]   (alias defaults to bd config -> $ZK_HOST_ALIAS -> hostname -s)
set -uo pipefail

ZK_ARTIFACTS_DIR="${ZK_ARTIFACTS_DIR:-$HOME/dev/zk-artifacts}"
ZK_FLOW_DIR="${ZK_FLOW_DIR:-$HOME/dev/zk-flow}"
CATALOG="$ZK_ARTIFACTS_DIR/skills/CATALOG.md"

[ -f "$CATALOG" ] || { echo "WARN no catalog at $CATALOG — run zk-artifacts/scripts/gen-skill-catalog.sh" >&2; exit 1; }

alias_name="${1:-}"
if [ -z "$alias_name" ]; then
  command -v bd >/dev/null 2>&1 && alias_name="$(cd "$ZK_FLOW_DIR" 2>/dev/null && bd config get host 2>/dev/null | tr -d '[:space:]')"
  case "$alias_name" in *notset*|"") alias_name="${ZK_HOST_ALIAS:-$(hostname -s 2>/dev/null)}" ;; esac
fi

# No alias resolvable -> pass the catalog through rather than silently emitting a
# catalog with every machine-specific skill stripped.
[ -n "$alias_name" ] || { command cat "$CATALOG"; exit 0; }

ZK_CATALOG_ALIAS="$alias_name" python3 - "$CATALOG" <<'PY'
import os, re, sys

alias = os.environ.get('ZK_CATALOG_ALIAS', '')

def keep(line):
    m = re.search(r'`([^`]+)`', line)
    if not m:
        return True                      # header / prose lines pass through
    parts = m.group(1).split('/')
    if len(parts) > 2 and parts[0] == 'agent' and parts[1] == 'machines':
        return parts[2] != 'archive' and parts[2] == alias
    return True

with open(sys.argv[1], encoding='utf-8') as f:
    sys.stdout.write(''.join(l for l in f if keep(l)))
PY
