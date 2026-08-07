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
  # persona SessionStart hook wired? (load-persona.sh in project or user settings)
  if grep -ql load-persona.sh "$ZK_FLOW_DIR/.claude/settings.json" "$HOME/.claude/settings.json" 2>/dev/null; then
    ok "persona SessionStart hook wired (load-persona.sh)"
  else
    warn "persona SessionStart hook NOT wired — add scripts/load-persona.sh to a SessionStart hook in .claude/settings.json"
  fi
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

# 7. Plugins: register the marketplace and install both plugins. This is what replaces
#    the hand-rolled agent copy + workflow symlink on a NEW machine — and it is the only
#    path that installs the skills as native plugin skills rather than zk-* symlinks.
if command -v claude >/dev/null 2>&1; then
  mk="$ZK_FLOW_DIR/.claude-plugin/marketplace.json"
  if [ -f "$mk" ]; then
    have_mk="$(claude plugin marketplace list 2>/dev/null | grep -c 'zk-flow-marketplace' || true)"
    if [ "${have_mk:-0}" -gt 0 ]; then
      ok "plugin marketplace registered (zk-flow-marketplace)"
    else
      claude plugin marketplace add "$ZK_FLOW_DIR" --scope user >/dev/null 2>&1 \
        && fix "registered plugin marketplace from $ZK_FLOW_DIR" \
        || warn "could not register the marketplace — run: claude plugin marketplace add $ZK_FLOW_DIR"
    fi
    for plug in zk-flow zkengine; do
      if claude plugin list 2>/dev/null | grep -q "^${plug}\b"; then
        ok "plugin ${plug} installed"
      else
        claude plugin install "${plug}@zk-flow-marketplace" --scope user >/dev/null 2>&1 \
          && fix "installed plugin ${plug}" \
          || warn "could not install ${plug} — run: claude plugin install ${plug}@zk-flow-marketplace"
      fi
    done
    # Double-fire guard: engine hooks live in the plugin now. If a project settings.json
    # still defines them, every Stop/SessionStart fires twice.
    if grep -q '"Stop"\|"SessionStart"' "$ZK_FLOW_DIR/.claude/settings.json" 2>/dev/null; then
      warn "project .claude/settings.json still defines Stop/SessionStart hooks — the plugin ships those, so they will fire TWICE. Remove them from settings.json."
    else
      ok "no duplicate engine hooks in project settings"
    fi
  else
    warn "no marketplace manifest at $mk"
  fi
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
