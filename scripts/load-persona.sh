#!/usr/bin/env bash
# zk-flow persona auto-load — SessionStart hook.
# Emits the current machine's persona as session context so the MAIN session has
# identity / repos-on-disk / networking / conventions immediately, instead of only
# the discover phase getting it (persona-load.js). Tokenless, never blocks.
#
# Machine-flexible by design — nothing hardcoded:
#   - ZK_ARTIFACTS_DIR / ZK_FLOW_DIR resolved from env, with $HOME fallbacks
#   - host alias from `bd config get host`, falling back to $ZK_HOST_ALIAS env
#   - silent no-op (exit 0) if the alias or the persona file is absent
# SessionStart hook stdout is injected as additional context (same as `bd prime`).
set -uo pipefail

ZK_ARTIFACTS_DIR="${ZK_ARTIFACTS_DIR:-$HOME/dev/zk-artifacts}"
ZK_FLOW_DIR="${ZK_FLOW_DIR:-$HOME/dev/zk-flow}"

# host alias: prefer bd config, fall back to $ZK_HOST_ALIAS env (cross-machine robust).
alias_name=""
command -v bd >/dev/null 2>&1 && alias_name="$(cd "$ZK_FLOW_DIR" 2>/dev/null && bd config get host 2>/dev/null | tr -d '[:space:]')"
case "$alias_name" in *notset*|"") alias_name="${ZK_HOST_ALIAS:-}" ;; esac  # bd unset -> env fallback
[ -n "$alias_name" ] || exit 0

machine_dir="$ZK_ARTIFACTS_DIR/skills/agent/machines/$alias_name"
persona="$machine_dir/persona.md"
[ -f "$persona" ] || exit 0

echo "## Machine persona (host: $alias_name) — auto-loaded by zk-flow SessionStart hook"
echo
cat "$persona"
# local-dev.md carries networking / paths / repos-on-disk when present.
if [ -f "$machine_dir/local-dev.md" ]; then echo; cat "$machine_dir/local-dev.md"; fi
# observability.md carries MCP -> signal routing (Grafana/Loki/Prometheus instances) when present.
if [ -f "$machine_dir/observability.md" ]; then echo; cat "$machine_dir/observability.md"; fi
exit 0
