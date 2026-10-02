#!/usr/bin/env bash
# Make zk-artifacts skills discoverable by ordinary Claude Code sessions.
#
# Claude Code discovers skills ONE level deep only:
#   ~/.claude/skills/<name>/SKILL.md   (personal)
#   .claude/skills/<name>/SKILL.md     (project)
#   <plugin>/skills/<name>/SKILL.md    (plugin)
# zk-artifacts nests up to five levels (skills/agent/machines/n/nebo/jira), so
# nothing there is visible on its own. This script flattens the tree into
# ~/.claude/skills/zk-<name> symlinks, derived from skills/CATALOG.md.
#
# Idempotent: re-running re-points changed links and prunes zk-* links whose
# source id no longer exists (renames/collapses leave no orphans).
#
# Usage:
#   install-skills.sh            install/refresh, then print a summary
#   install-skills.sh --check    report only, exit 1 if install would change anything
#   install-skills.sh --all      also install other machines' + archived skills
set -uo pipefail

MODE="write"; SCOPE="host"
for arg in "$@"; do
  case "$arg" in
    --check) MODE="check" ;;
    --all)   SCOPE="all" ;;
    *) echo "unknown arg: $arg" >&2; exit 2 ;;
  esac
done

ZK_ARTIFACTS_DIR="${ZK_ARTIFACTS_DIR:-$HOME/dev/zk-artifacts}"

# The zkengine PLUGIN now ships these same skills as /zkengine:<name>. Installing the full
# symlink set on top of it publishes every skill twice under two names, doubling what the
# model reads in its skill listing for zero added coverage.
#
# So: when the plugin is present, install ONLY what it cannot carry — skills whose directory
# is a symlink pointing OUTSIDE zk-artifacts (the nebo/* tools). Claude Code copies a plugin
# to its cache and does not follow symlinks that resolve outside the plugin, so those 15 are
# genuinely missing from the plugin and would otherwise be lost.
# Without the plugin (a machine that only cloned the repos), install everything as before.
PLUGIN_PRESENT=0
if [ "$SCOPE" != "all" ] && command -v claude >/dev/null 2>&1; then
  claude plugin list 2>/dev/null | grep -q '^\s*.\?\s*zkengine@' && PLUGIN_PRESENT=1
fi
ZK_FLOW_DIR="${ZK_FLOW_DIR:-$HOME/dev/zk-flow}"
CATALOG="$ZK_ARTIFACTS_DIR/skills/CATALOG.md"
DEST="$HOME/.claude/skills"
PREFIX="zk-"

[ -f "$CATALOG" ] || { echo "WARN no catalog at $CATALOG — set ZK_ARTIFACTS_DIR or run zk-artifacts/scripts/gen-skill-catalog.sh"; exit 1; }
command -v python3 >/dev/null 2>&1 || { echo "WARN python3 required for name derivation"; exit 1; }

# Host alias: bd config, else $ZK_HOST_ALIAS, else short hostname. Used to skip
# other machines' persona/repo skills (they are noise on this box).
alias_name="$(cd "$ZK_FLOW_DIR" 2>/dev/null && bd config get host 2>/dev/null | tr -d '[:space:]')"
case "$alias_name" in *notset*|"") alias_name="${ZK_HOST_ALIAS:-$(hostname -s 2>/dev/null)}" ;; esac

# Derive collision-free flat names from catalog ids (leaf -> parent-leaf -> full path).
NAMER="$ZK_FLOW_DIR/scripts/skill-flat-names.py"
[ -f "$NAMER" ] || { echo "WARN missing $NAMER"; exit 1; }
mapping="$(python3 "$NAMER" "$CATALOG" "$SCOPE" "$alias_name")"

[ -n "$mapping" ] || { echo "WARN catalog produced no skill ids"; exit 1; }

mkdir -p "$DEST"
installed=0; relinked=0; pruned=0; missing=0; drift=0; covered_by_plugin=0
declare -a want=()

while IFS=$'\t' read -r name sid; do
  [ -n "$name" ] || continue
  src="$ZK_ARTIFACTS_DIR/skills/$sid"
  # Plugin present: skip anything the plugin already carries. A skill dir that is a real
  # directory (not a symlink out of the tree) ships fine inside the plugin.
  if [ "$PLUGIN_PRESENT" = "1" ]; then
    real="$(cd "$src" 2>/dev/null && pwd -P || true)"
    case "$real" in
      "$ZK_ARTIFACTS_DIR"/*) covered_by_plugin=$((covered_by_plugin+1)); continue ;;
    esac
  fi
  link="$DEST/${PREFIX}${name}"
  want+=("${PREFIX}${name}")
  if [ ! -f "$src/SKILL.md" ]; then
    echo "WARN catalog id has no SKILL.md on disk: $sid"
    missing=$((missing+1)); continue
  fi
  current="$(readlink "$link" 2>/dev/null || true)"
  if [ "$current" = "$src" ]; then
    continue
  fi
  drift=$((drift+1))
  [ "$MODE" = "check" ] && continue
  if [ -e "$link" ] && [ ! -L "$link" ]; then
    echo "WARN $link exists and is not a symlink — left untouched"
    continue
  fi
  ln -sfn "$src" "$link"
  if [ -n "$current" ]; then relinked=$((relinked+1)); else installed=$((installed+1)); fi
done <<< "$mapping"

# Prune zk-* symlinks that are no longer in the catalog (collapsed/renamed ids).
for link in "$DEST/${PREFIX}"*; do
  [ -L "$link" ] || continue
  base="$(basename "$link")"
  keep=0
  if [ "${#want[@]}" -gt 0 ]; then
    for w in "${want[@]}"; do [ "$w" = "$base" ] && { keep=1; break; }; done
  fi
  [ "$keep" = 1 ] && continue
  drift=$((drift+1))
  [ "$MODE" = "check" ] && { echo "STALE $base (not in catalog)"; continue; }
  rm -f "$link"; pruned=$((pruned+1))
done

total="$(printf '%s\n' "$mapping" | grep -c . )"
if [ "$MODE" = "check" ]; then
  if [ "$drift" -gt 0 ]; then
    echo "STALE ~/.claude/skills is out of sync with the catalog ($drift change(s) pending, scope=$SCOPE) — run scripts/install-skills.sh"
    exit 1
  fi
  echo "OK   ${total} zk-* skills installed in ~/.claude/skills (scope=$SCOPE, host=${alias_name:-unknown})"
  exit 0
fi

if [ "$PLUGIN_PRESENT" = "1" ]; then
  echo "installed=$installed relinked=$relinked pruned=$pruned missing=$missing symlinked=${#want[@]} covered_by_plugin=$covered_by_plugin total=$total scope=$SCOPE host=${alias_name:-unknown}"
  echo "zkengine plugin detected: symlinked ONLY the skills it cannot carry (targets outside the repo); the rest are /zkengine:<name>."
else
  echo "installed=$installed relinked=$relinked pruned=$pruned missing=$missing total=$total scope=$SCOPE host=${alias_name:-unknown}"
fi
echo "Skills are now invocable as /${PREFIX}<name> (restart the session to pick up new ones)."
