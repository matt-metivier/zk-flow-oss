#!/usr/bin/env bash
# zk-flow onboarding — idempotent auto-fix of the setup pieces /health only reports.
# Safe to re-run: every step checks-then-fixes and no-ops when already correct.
# Fixes the exact wiring bugs that bit us by hand: MCP servers never approved,
# repo agents never synced to ~/.claude/agents (stale tool grants), bd not init'd.
set -uo pipefail

ZK_FLOW_DIR="${ZK_FLOW_DIR:-$HOME/dev/zk-flow}"
note() { printf '%s\n' "$*"; }
ok()   { printf 'OK   %s\n' "$*"; }
fix()  { printf 'FIX  %s\n' "$*"; }
warn() { printf 'WARN %s\n' "$*"; }

note "== zk-flow onboard (idempotent) =="

# 0. CLI prereqs (cannot fix automatically — surface a clean install line).
miss=""
for c in jq node npm git gh claude; do command -v "$c" >/dev/null 2>&1 || miss="$miss $c"; done
if [ -n "$miss" ]; then
  warn "missing CLIs:$miss  -> brew install$miss   (gh: also 'gh auth login')"
else
  ok "CLI prereqs (jq node npm git gh claude)"
fi

# 1. MCP servers at USER scope (codebase-memory-mcp must already exist; we add the
#    two that are commonly declared-but-unapproved). 'claude mcp add' is idempotent
#    enough — guard on 'claude mcp list' so we don't duplicate.
if command -v claude >/dev/null 2>&1; then
  connected="$(claude mcp list 2>/dev/null || true)"
  add_mcp() { # name  cmd...
    local name="$1"; shift
    if printf '%s' "$connected" | grep -q "^${name}\b"; then
      ok "MCP ${name} already wired"
    else
      claude mcp add "$name" --scope user -- "$@" >/dev/null 2>&1 \
        && fix "wired MCP ${name} (user scope)" \
        || warn "could not wire MCP ${name} (add manually: claude mcp add ${name} --scope user -- $*)"
    fi
  }
  add_mcp repomix npx repomix --mcp
  add_mcp octocode npx -y octocode-mcp
  printf '%s' "$connected" | grep -q "^codebase-memory-mcp\b" \
    && ok "MCP codebase-memory-mcp wired" \
    || warn "codebase-memory-mcp NOT wired — install per its README, then 'claude mcp add --scope user'"
else
  warn "claude CLI absent — cannot wire MCP servers"
fi

# 2. Sync repo agents -> global (the migration step that goes stale: live agents
#    load from ~/.claude/agents, NOT the repo). Always copy; cheap + idempotent.
if [ -d "$ZK_FLOW_DIR/.claude/agents" ]; then
  mkdir -p "$HOME/.claude/agents"
  if cp "$ZK_FLOW_DIR"/.claude/agents/*.md "$HOME/.claude/agents/" 2>/dev/null; then
    n="$(ls "$ZK_FLOW_DIR"/.claude/agents/*.md 2>/dev/null | wc -l | tr -d ' ')"
    fix "synced ${n} agents -> ~/.claude/agents"
    if grep -rlq "codegraphcontext" "$HOME/.claude/agents/"*.md 2>/dev/null; then
      warn "stale codegraphcontext grant still in a global agent — investigate"
    else
      ok "global agents on codebase-memory-mcp (no stale cgc)"
    fi
  else
    warn "could not copy agents to ~/.claude/agents"
  fi
else
  warn "no .claude/agents in $ZK_FLOW_DIR"
fi

# 3. bd: present + DB initialized. bd init only when no .beads here (mutating but safe).
if command -v bd >/dev/null 2>&1; then
  ok "bd installed ($(bd --version 2>/dev/null | head -1))"
  beads_dir="${BEADS_DIR:-$ZK_FLOW_DIR/.beads}"
  if [ -d "$beads_dir" ]; then
    ok "beads DB present ($beads_dir)"
  else
    ( cd "$ZK_FLOW_DIR" && bd init >/dev/null 2>&1 ) \
      && fix "bd init in $ZK_FLOW_DIR" \
      || warn "bd init failed — run 'cd $ZK_FLOW_DIR && bd init' manually"
  fi
  [ -n "${BEADS_DIR:-}" ] && ok "BEADS_DIR=$BEADS_DIR" \
    || warn "BEADS_DIR unset — workflows from other cwds can't find the DB. Add to shell profile: export BEADS_DIR=$ZK_FLOW_DIR/.beads"
else
  warn "bd CLI absent — install beads, then re-run"
fi

# 4. Artifacts dir + persona (cannot edit shell profile safely — surface the export).
if [ -n "${ZK_ARTIFACTS_DIR:-}" ] && [ -d "${ZK_ARTIFACTS_DIR:-/nonexistent}" ]; then
  ok "ZK_ARTIFACTS_DIR=$ZK_ARTIFACTS_DIR"
  # host alias: bd config, else $ZK_HOST_ALIAS env; if bd unset but env present, persist it.
  alias_name="$(cd "$ZK_FLOW_DIR" 2>/dev/null && bd config get host 2>/dev/null | tr -d '[:space:]')"
  case "$alias_name" in *notset*|"") alias_name="" ;; esac  # bd prints "(not set)" -> stripped to "notset"
  if [ -z "$alias_name" ] && [ -n "${ZK_HOST_ALIAS:-}" ]; then
    ( cd "$ZK_FLOW_DIR" && bd config set host "$ZK_HOST_ALIAS" >/dev/null 2>&1 ) \
      && { alias_name="$ZK_HOST_ALIAS"; fix "bd config set host $ZK_HOST_ALIAS (from \$ZK_HOST_ALIAS)"; }
  fi
  persona="$ZK_ARTIFACTS_DIR/skills/agent/machines/${alias_name}/persona.md"
  if [ -n "$alias_name" ] && [ -f "$persona" ]; then
    ok "persona present for host '$alias_name'"
  else
    warn "no persona at $persona (host alias='${alias_name:-unset}') — set 'export ZK_HOST_ALIAS=<alias>' or 'bd config set host <alias>', then create the persona"
  fi
  # (the persona SessionStart hook itself is wired in phase 7b with the other engine hooks)
else
  warn "ZK_ARTIFACTS_DIR unset/missing — add to shell profile: export ZK_ARTIFACTS_DIR=~/dev/zk-artifacts"
fi

# 5. Skills: catalog freshness + native discovery.
#    Two failure modes this fixes, both silent before:
#    (a) skills/CATALOG.md drifts from skills/ on disk, so discover selects ids
#        that no longer exist (skill-render only fails when ALL of them are gone);
#    (b) nothing installs the skills where Claude Code can find them — discovery
#        is one level deep (~/.claude/skills/<name>/SKILL.md) and the artifacts
#        tree nests up to five, so 80+ skills were invisible in normal sessions.
if [ -n "${ZK_ARTIFACTS_DIR:-}" ] && [ -d "${ZK_ARTIFACTS_DIR:-/nonexistent}" ]; then
  gen="$ZK_ARTIFACTS_DIR/scripts/gen-skill-catalog.sh"
  if [ -x "$gen" ] || [ -f "$gen" ]; then
    if bash "$gen" --check >/dev/null 2>&1; then
      ok "skills/CATALOG.md up to date"
    else
      bash "$gen" >/dev/null 2>&1 \
        && fix "regenerated skills/CATALOG.md (was stale — commit it in zk-artifacts)" \
        || warn "could not regenerate skills/CATALOG.md — run $gen"
    fi
  else
    warn "no catalog generator at $gen"
  fi
  out="$(bash "$ZK_FLOW_DIR/scripts/install-skills.sh" 2>&1)"
  if printf '%s' "$out" | grep -q '^installed='; then
    summary="$(printf '%s' "$out" | grep '^installed=')"
    case "$summary" in
      *installed=0*relinked=0*pruned=0*) ok "native skills already installed ($summary)" ;;
      *) fix "installed native skills in ~/.claude/skills ($summary)" ;;
    esac
    printf '%s' "$out" | grep '^WARN' | sed 's/^/     /'
  else
    warn "install-skills.sh failed: $(printf '%s' "$out" | tail -1)"
  fi
else
  warn "ZK_ARTIFACTS_DIR unset/missing — skipped catalog check + native skill install"
fi

# 6. Build workflows so the slash commands resolve.
if [ -f "$ZK_FLOW_DIR/package.json" ]; then
  ( cd "$ZK_FLOW_DIR" && npm run build >/dev/null 2>&1 ) \
    && ok "workflows built" \
    || warn "npm run build failed in $ZK_FLOW_DIR"
fi

# 7. Live wiring: ~/.claude/{commands,workflows} symlinked at the repo, plugins kept OFF.
#
#    The plugin path was tried and reverted. `claude plugin install` COPIES the repo into
#    a versioned cache — for zk-flow a flat snapshot, not even a git clone — so /zk-flow:*
#    served whatever the tree looked like at install time and went stale on the very next
#    `npm run build`, while publishing every command, agent, and skill a SECOND time under
#    a second name. A symlink is always current and costs nothing. Hooks that the plugin
#    used to ship (bd prime, load-persona, daily-accumulate, improve-suggest) belong in
#    ~/.claude/settings.json instead — see docs/onboarding/.
for _pair in "commands:$ZK_FLOW_DIR/.claude/commands" "workflows:$ZK_FLOW_DIR/.claude/workflows"; do
  _name="${_pair%%:*}"; _target="${_pair#*:}"; _link="$HOME/.claude/$_name"
  [ -d "$_target" ] || continue
  if [ "$(readlink "$_link" 2>/dev/null)" = "$_target" ]; then
    ok "~/.claude/$_name -> repo (live)"
  elif [ -e "$_link" ] && [ ! -L "$_link" ]; then
    warn "$_link is a real directory, not a symlink — move it aside and re-run to get live $_name"
  else
    ln -sfn "$_target" "$_link" && fix "linked ~/.claude/$_name -> $_target" \
      || warn "could not link $_link -> $_target"
  fi
done

if command -v claude >/dev/null 2>&1; then
  for plug in zk-flow zkengine; do
    if claude plugin list 2>/dev/null | grep -q "^${plug}\b"; then
      claude plugin uninstall "${plug}@zk-flow-marketplace" >/dev/null 2>&1 \
        && fix "uninstalled ${plug} plugin (stale snapshot; superseded by live symlinks)" \
        || warn "could not uninstall ${plug} — run: claude plugin uninstall ${plug}@zk-flow-marketplace"
    fi
  done
  if claude plugin marketplace list 2>/dev/null | grep -q 'zk-flow-marketplace'; then
    claude plugin marketplace remove zk-flow-marketplace >/dev/null 2>&1 \
      && fix "removed zk-flow-marketplace" \
      || warn "could not remove zk-flow-marketplace — run: claude plugin marketplace remove zk-flow-marketplace"
  else
    ok "zk-flow plugins off (commands/agents/skills served live, once each)"
  fi
fi

# 7b. Engine hooks in ~/.claude/settings.json.
#     These used to ship inside the plugin (hooks/hooks.json, ${CLAUDE_PLUGIN_ROOT}). With the
#     plugin off nothing else installs them, and EVERY one fails silently when missing: no
#     machine identity, no bead context, no daily digest, no self-improve signal. Match on the
#     exact command string so re-running never double-wires (a duplicate fires twice per event).
US="$HOME/.claude/settings.json"
[ -f "$US" ] || echo '{}' > "$US"
hook_add() {
  evt="$1"; cmd="$2"; label="$3"
  if jq -e --arg e "$evt" --arg c "$cmd" '[.hooks[$e][]?.hooks[]?.command] | index($c)' "$US" >/dev/null 2>&1; then
    ok "hook wired: $label"
  else
    _t="$(mktemp)"
    jq --arg e "$evt" --arg c "$cmd" \
      '.hooks[$e] = ((.hooks[$e] // []) + [{matcher:"",hooks:[{type:"command",command:$c}]}])' \
      "$US" > "$_t" 2>/dev/null && mv "$_t" "$US" \
      && fix "wired $label ($evt hook)" \
      || { rm -f "$_t"; warn "could not wire $label into $US"; }
  fi
}
hook_add_m() {
  evt="$1"; matcher="$2"; cmd="$3"; label="$4"
  if jq -e --arg e "$evt" --arg c "$cmd" '[.hooks[$e][]?.hooks[]?.command // empty] | index($c)' "$US" >/dev/null 2>&1; then
    ok "hook wired: $label"
  else
    _t="$(mktemp)"
    jq --arg e "$evt" --arg m "$matcher" --arg c "$cmd" \
      '.hooks[$e] = ((.hooks[$e] // []) + [{matcher:$m,hooks:[{type:"command",command:$c}]}])' \
      "$US" > "$_t" 2>/dev/null && mv "$_t" "$US" \
      && fix "wired $label ($evt hook, matcher $matcher)" \
      || { rm -f "$_t"; warn "could not wire $label into $US"; }
  fi
}
hook_add SessionStart "bd prime" "bd prime"
hook_add SessionStart "bash $ZK_FLOW_DIR/scripts/load-persona.sh" "load-persona (machine identity)"
hook_add PreCompact   "bd prime" "bd prime after compaction"
hook_add Stop "bash $ZK_FLOW_DIR/scripts/daily-accumulate.sh 2>/dev/null || true" "daily-accumulate"
hook_add Stop "bash $ZK_FLOW_DIR/scripts/improve-suggest.sh 2>/dev/null || true" "improve-suggest"

# 7b-i. Humanizer gate. Anything another person reads -- a Slack message, a PR or MR body,
#       a Linear comment, a Front reply -- goes through the humanizer skill first, so it
#       reads like the operator wrote it rather than like a model did. The gate denies those
#       writes until humanizer has run in the session, and consumes the marker on each post.
#       Escape hatch: touch ~/.claude/.humanizer-off
_HG_MATCH='Bash|mcp__.*slack_(send_message|schedule_message|create_canvas|update_canvas)|mcp__.*Linear__save_(comment|status_update|document)|mcp__.*Front_MCP__(send_message|create_draft|add_comment)|mcp__.*Notion__notion-create-comment'
hook_add_m PreToolUse "$_HG_MATCH" "bash $ZK_FLOW_DIR/scripts/humanizer-gate.sh" "humanizer gate (blocks unhumanized human-facing writes)"
hook_add_m PreToolUse "Skill" "bash $ZK_FLOW_DIR/scripts/humanizer-mark.sh" "humanizer marker (records a humanizer run)"

# 7c. daily-digest launchd timer. /health checks this but nothing installed it — it was wired
#     by hand on every machine. The plist must carry a PATH: launchd does not read your shell
#     profile, so without one `bd` is unreachable and the rollup writes nothing, silently.
_plist="$HOME/Library/LaunchAgents/com.zk-flow.daily-rollup.plist"
_dd_path="$(/usr/libexec/PlistBuddy -c 'Print :EnvironmentVariables:PATH' "$_plist" 2>/dev/null || true)"
case "$_dd_path" in *homebrew*|*local/bin*) _dd_path_ok=1 ;; *) _dd_path_ok=0 ;; esac
if launchctl list 2>/dev/null | grep -q com.zk-flow.daily-rollup && [ "$_dd_path_ok" = 1 ]; then
  ok "daily-rollup timer loaded (plist PATH reaches bd)"
elif [ -x "$ZK_FLOW_DIR/scripts/daily-rollup.sh" ]; then
  ( cd "$ZK_FLOW_DIR" && bash scripts/daily-rollup.sh --install >/dev/null 2>&1 ) \
    && fix "installed daily-rollup launchd timer" \
    || warn "could not install the daily-rollup timer — run: cd $ZK_FLOW_DIR && scripts/daily-rollup.sh --install"
else
  warn "no executable $ZK_FLOW_DIR/scripts/daily-rollup.sh"
fi

# 8. cbm index: check if repos are indexed; warn if not (daily-rollup refreshes nightly).
if command -v npx >/dev/null 2>&1; then
  _cbm_count=$(npx --yes codebase-memory-mcp cli list_projects 2>/dev/null | jq '.projects | length' 2>/dev/null || echo 0)
  if [ "${_cbm_count:-0}" -gt 0 ]; then
    ok "cbm: $_cbm_count repo(s) indexed (nightly refresh via daily-rollup)"
  else
    warn "cbm: no repos indexed — run once per machine to enable graph queries:
  ZK_PARENT=\$(dirname \"\${ZK_FLOW_DIR:-\$HOME/dev/zk-flow}\")
  for d in \"\$ZK_PARENT\"/*/; do [ -d \"\${d}.git\" ] && npx -y codebase-memory-mcp cli index_repository \"{\\\"repo_path\\\":\\\"\${d%/}\\\"}\" & done; wait"
  fi
fi

note ""
note "Onboard done. Run /health for a fail-hard verification pass."
