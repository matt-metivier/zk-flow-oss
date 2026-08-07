Run a zk-flow setup health check.

Arguments: $ARGUMENTS

Checks all required pieces are in place before running workflows.

**Checks:**

0. CLI prereqs present (`jq`, `node`, `npm`, `git`, `gh`) — runs FIRST so the
   check reports a clean missing-tool error instead of crashing mid-run
1. `ZK_ARTIFACTS_DIR` set + directory exists
2. `ZK_VAULT_DIR` set + directory exists
3. `BEADS_DIR` set + points at an existing `.beads` directory (REQUIRED)
4. bd resolves from a NON-zk-flow cwd (`cd / && bd ready` exits 0) — the real
   failure mode: workflows run from `~/dev`, and without `BEADS_DIR` bd can't
   find the DB, so phase artifacts never persist and the run stalls at design
5. `npm run build` produces ≥13 workflow files
6. `~/.claude/workflows/` symlink intact
7. `~/.claude/agents/` contains zk-flow agents
8. `bd` CLI installed (`bd --version`)
9. context-mode plugin enabled in `~/.claude.json`
10. Todoist MCP wired in `~/.claude.json` (`mcpServers.todoist`)
11. daily-digest installed: scripts executable, Stop-hook accumulator wired (user or project settings), launchd rollup timer loaded
12. code-intel MCP: `codebase-memory-mcp` global in `~/.claude.json` + `repomix`/`octocode` in `$ZK_FLOW_DIR/.mcp.json`; no stale `codegraphcontext` (cbm migration)
13. machine persona auto-load: `scripts/load-persona.sh` wired in a SessionStart
    hook (project or user `settings.json`); host alias resolves (`bd config get host`
    or `$ZK_HOST_ALIAS`); persona file exists at
    `$ZK_ARTIFACTS_DIR/skills/agent/machines/<alias>/persona.md`. Without it the main
    session starts with no machine identity (silent — easy to miss).
14. daily-digest is actually PRODUCING: newest `zk-flow-daily-<host>-<date>` bead is
    <=3 days old AND the launchd plist carries a PATH that can reach `bd`. The old check
    only verified wiring and passed for seven weeks while the rollup silently wrote nothing.
15. skills wired: `skills/CATALOG.md` matches `skills/` on disk (stale catalog =
    discover selects ids that no longer exist), and the catalog's skills are
    installed as `~/.claude/skills/zk-*` links so ordinary sessions can find them
    (Claude Code discovery is one level deep; the artifacts tree nests five)

This check is **fail-hard**: bd/`BEADS_DIR` misconfiguration exits non-zero so a
broken setup can never silently degrade a run.

**Run:**
```bash
fail=0
# Check 0 — CLI prereqs FIRST (the rest of this script needs jq/node/npm/git/gh).
miss=""
for c in jq node npm git gh; do command -v "$c" >/dev/null 2>&1 || miss="$miss $c"; done
[ -z "$miss" ] \
  && echo "PASS CLI prereqs (jq node npm git gh)" \
  || { echo "FAIL missing CLIs:$miss -> brew install$miss (gh: also gh auth login)"; echo "HEALTH: FAIL"; exit 1; }
[ -n "$ZK_ARTIFACTS_DIR" ] && [ -d "$ZK_ARTIFACTS_DIR" ] \
  && echo "PASS ZK_ARTIFACTS_DIR=$ZK_ARTIFACTS_DIR" \
  || { echo "FAIL ZK_ARTIFACTS_DIR unset/missing -> export ZK_ARTIFACTS_DIR=~/dev/zk-artifacts"; fail=1; }
[ -n "$ZK_VAULT_DIR" ] && [ -d "$ZK_VAULT_DIR" ] \
  && echo "PASS ZK_VAULT_DIR=$ZK_VAULT_DIR" \
  || { echo "FAIL ZK_VAULT_DIR unset/missing -> export ZK_VAULT_DIR=\$ZK_ARTIFACTS_DIR/vault"; fail=1; }
[ -n "$BEADS_DIR" ] && [ -d "$BEADS_DIR" ] \
  && echo "PASS BEADS_DIR=$BEADS_DIR" \
  || { echo "FAIL BEADS_DIR unset/missing -> export BEADS_DIR=~/dev/zk-flow/.beads AND add to ~/.claude/settings.json env"; fail=1; }
( cd / && bd ready >/dev/null 2>&1 ) \
  && echo "PASS bd resolves from any cwd" \
  || { echo "FAIL bd unreachable outside zk-flow -> set BEADS_DIR; workflows from ~/dev cannot persist phase artifacts"; fail=1; }
n=$(ls ~/.claude/workflows/*.js 2>/dev/null | wc -l | tr -d ' '); [ "${n:-0}" -ge 13 ] \
  && echo "PASS $n workflow files" \
  || { echo "FAIL only ${n:-0} workflow files (need >=13) -> npm run build"; fail=1; }
a=$(ls ~/.claude/agents/ 2>/dev/null | wc -l | tr -d ' '); [ "${a:-0}" -gt 0 ] \
  && echo "PASS $a agents" \
  || { echo "FAIL no agents in ~/.claude/agents -> copy zk-flow agents"; fail=1; }
command -v bd >/dev/null 2>&1 \
  && echo "PASS bd installed ($(bd --version 2>/dev/null | head -1))" \
  || { echo "FAIL bd CLI not installed -> install beads (bd)"; fail=1; }
jq -e '.enabledPlugins["context-mode@context-mode"] == true' ~/.claude/settings.json >/dev/null 2>&1 \
  && echo "PASS context-mode plugin enabled" \
  || { echo "FAIL context-mode not enabled -> /plugin marketplace add mksglu/context-mode && /plugin install context-mode@context-mode"; fail=1; }
jq -e '.mcpServers.todoist' ~/.claude.json >/dev/null 2>&1 \
  && echo "PASS todoist MCP wired" \
  || { echo "FAIL todoist MCP not wired -> add mcpServers.todoist (npx -y @doist/todoist-mcp, env TODOIST_API_KEY) to ~/.claude.json"; fail=1; }
ZK="${ZK_FLOW_DIR:-$HOME/dev/zk-flow}"
dd_ok=1
[ -x "$ZK/scripts/daily-accumulate.sh" ] && [ -x "$ZK/scripts/daily-rollup.sh" ] || dd_ok=0
grep -ql daily-accumulate ~/.claude/settings.json "$ZK/.claude/settings.json" 2>/dev/null || dd_ok=0
launchctl list 2>/dev/null | grep -q com.zk-flow.daily-rollup || dd_ok=0
[ "$dd_ok" = 1 ] \
  && echo "PASS daily-digest installed (scripts + Stop hook + launchd timer)" \
  || { echo "FAIL daily-digest not fully installed -> cd \$ZK_FLOW_DIR && scripts/daily-rollup.sh --install AND wire the daily-accumulate.sh Stop hook (see onboard Phase 6)"; fail=1; }
# Wiring can be perfect while the producer writes nothing: launchd does not read your
# shell profile, so a plist without PATH cannot find bd, and every bd call in the rollup is
# output-suppressed. That failed silently for 7 weeks. Check the OUTPUT, not just the wiring.
dd_host=$(hostname -s | tr 'A-Z' 'a-z')
dd_recent=$( (cd "$ZK" 2>/dev/null && bd list --json 2>/dev/null) | jq -r --arg h "$dd_host" \
  '[.[] | select(.id | test("daily-" + $h)) | .id] | sort | last // empty' 2>/dev/null)
dd_day=$(printf '%s' "$dd_recent" | grep -oE '[0-9]{8}$' || true)
dd_age=99
[ -n "$dd_day" ] && dd_age=$(( ( $(date +%s) - $(date -j -f %Y%m%d "$dd_day" +%s 2>/dev/null || echo 0) ) / 86400 ))
dd_plist_path=$(/usr/libexec/PlistBuddy -c 'Print :EnvironmentVariables:PATH' "$HOME/Library/LaunchAgents/com.zk-flow.daily-rollup.plist" 2>/dev/null || true)
case "$dd_plist_path" in *homebrew*|*local/bin*) dd_path_ok=1 ;; *) dd_path_ok=0 ;; esac
if [ "$dd_age" -le 3 ] && [ "$dd_path_ok" = 1 ]; then
  echo "PASS daily-digest producing (latest ${dd_recent:-none}, ${dd_age}d old; plist PATH reaches bd)"
else
  [ "$dd_path_ok" = 1 ] || echo "FAIL daily-rollup plist has no Homebrew PATH -> bd unreachable under launchd; run scripts/daily-rollup.sh --install"
  [ "$dd_age" -le 3 ] || echo "FAIL newest daily digest bead is ${dd_age}d old (${dd_recent:-none}) -> check \$ZKFLOW_DAILY_DIR/rollup.log"
  fail=1
fi
mcpf="$ZK/.mcp.json"; mcp_ok=1
jq -e '.mcpServers["codebase-memory-mcp"]' ~/.claude.json >/dev/null 2>&1 || { echo "FAIL codebase-memory-mcp not in ~/.claude.json -> install cbm (github.com/DeusData/codebase-memory-mcp) + add global mcpServers entry (bare command, no abs path)"; mcp_ok=0; }
for s in repomix octocode; do jq -e --arg s "$s" '.mcpServers[$s]' "$mcpf" >/dev/null 2>&1 || { echo "FAIL $s missing from $mcpf"; mcp_ok=0; }; done
jq -e '.mcpServers.codegraphcontext' "$mcpf" >/dev/null 2>&1 && { echo "FAIL stale codegraphcontext still in $mcpf -> removed in cbm migration; delete the entry"; mcp_ok=0; }
[ "$mcp_ok" = 1 ] \
  && echo "PASS code-intel MCP (cbm global + repomix/octocode per-repo, no stale cgc)" \
  || { fail=1; }
# 13. machine persona auto-load: hook wired + alias resolves + persona file exists
p_ok=1
grep -ql load-persona.sh ~/.claude/settings.json "$ZK/.claude/settings.json" 2>/dev/null \
  || { echo "FAIL persona SessionStart hook not wired -> add scripts/load-persona.sh to a SessionStart hook in .claude/settings.json"; p_ok=0; }
p_alias="$(cd "$ZK" 2>/dev/null && bd config get host 2>/dev/null | tr -d '[:space:]')"; case "$p_alias" in *notset*|"") p_alias="${ZK_HOST_ALIAS:-}";; esac
[ -n "$p_alias" ] || { echo "FAIL host alias unset -> 'bd config set host <alias>' or export ZK_HOST_ALIAS=<alias>"; p_ok=0; }
p_file="${ZK_ARTIFACTS_DIR:-$HOME/dev/zk-artifacts}/skills/agent/machines/${p_alias}/persona.md"
{ [ -n "$p_alias" ] && [ -f "$p_file" ]; } || { echo "FAIL persona missing at $p_file"; p_ok=0; }
[ "$p_ok" = 1 ] \
  && echo "PASS machine persona auto-load (hook + alias $p_alias + persona.md)" \
  || fail=1
# 14. skills wired: catalog fresh + flattened into ~/.claude/skills for discovery
s_ok=1
s_gen="${ZK_ARTIFACTS_DIR:-$HOME/dev/zk-artifacts}/scripts/gen-skill-catalog.sh"
if [ -f "$s_gen" ]; then
  bash "$s_gen" --check >/dev/null 2>&1 || { echo "FAIL skills/CATALOG.md is stale -> run $s_gen (discover selects ids that no longer exist)"; s_ok=0; }
else
  echo "FAIL no catalog generator at $s_gen"; s_ok=0
fi
s_out="$(bash "$ZK/scripts/install-skills.sh" --check 2>&1)"
printf '%s' "$s_out" | grep -q '^OK' || { echo "FAIL native skills not installed/out of sync -> $ZK/scripts/install-skills.sh"; printf '%s\n' "$s_out" | head -3 | sed 's/^/     /'; s_ok=0; }
s_n=$(ls -d ~/.claude/skills/zk-* 2>/dev/null | wc -l | tr -d ' ')
# Coverage invariant: every catalog id must be reachable EXACTLY once — via the zkengine
# plugin (dirs inside the repo) or via a zk-* symlink (dirs resolving outside it, i.e.
# nebo/*, which a plugin cache cannot carry). Installing both paths in full publishes every
# skill twice under two names and doubles what the model reads in its skill listing.
s_art="${ZK_ARTIFACTS_DIR:-$HOME/dev/zk-artifacts}"
s_cache=$(ls -d "$HOME"/.claude/plugins/cache/zk-flow-marketplace/zkengine/*/ 2>/dev/null | tail -1)
s_unreach=0; s_dupe=0
if [ -n "$s_cache" ] && [ -f "$s_art/skills/CATALOG.md" ]; then
  while IFS= read -r s_line; do
    s_id=$(printf '%s' "$s_line" | sed -n 's/^- `\([^`]*\)`.*/\1/p'); [ -z "$s_id" ] || {
      s_leaf=$(basename "$s_id")
      s_inplug=0; [ -f "$s_cache/skills/$s_id/SKILL.md" ] && s_inplug=1
      s_inlink=0; [ -e "$HOME/.claude/skills/zk-$s_leaf" ] && s_inlink=1
      [ "$s_inplug" = 0 ] && [ "$s_inlink" = 0 ] && { echo "     unreachable skill: $s_id"; s_unreach=$((s_unreach+1)); }
      [ "$s_inplug" = 1 ] && [ "$s_inlink" = 1 ] && s_dupe=$((s_dupe+1))
    }
  done < "$s_art/skills/CATALOG.md"
  [ "$s_unreach" = 0 ] || { echo "FAIL $s_unreach catalog skill(s) reachable by neither the plugin nor a symlink -> run scripts/install-skills.sh"; s_ok=0; }
  [ "$s_dupe" = 0 ] || { echo "FAIL $s_dupe skill(s) published TWICE (plugin + symlink) -> run scripts/install-skills.sh; it prunes what the plugin covers"; s_ok=0; }
fi
[ "$s_ok" = 1 ] \
  && echo "PASS skills wired (catalog fresh; $s_n symlinked + plugin-covered, 0 duplicated, 0 unreachable)" \
  || fail=1
[ "$fail" = 0 ] && echo "HEALTH: PASS" || { echo "HEALTH: FAIL"; exit 1; }
```

Emit the pass/fail summary above verbatim. If `HEALTH: FAIL`, the run exits
non-zero and the printed `FAIL ... -> <fix>` lines are the exact remediation.
