#!/usr/bin/env bash
# prune-worktrees.sh — Clean up stale zkflow/* git worktrees left behind after
# non-success workflow exits (needs_human / handoff). The workflow JS sandbox
# cannot run git, so this out-of-band script handles cleanup.
#
# Usage:
#   scripts/prune-worktrees.sh             # prune stale worktrees (default)
#   scripts/prune-worktrees.sh --dry-run   # print what would be removed, exit 0
#
# Environment:
#   STALE_MINUTES  — age threshold in minutes (default: 60). Worktrees whose
#                    HEAD commit is older than this are considered stale.
#
# Safety:
#   - Only touches worktrees on branches matching 'zkflow/*'.
#   - Runs `git worktree prune` first to remove already-gone paths.
#   - Never deletes a worktree on main/master/develop.
#   - --dry-run always exits 0 and makes no changes.
set -euo pipefail

DRY_RUN=0
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
  shift
done

STALE_MINUTES="${STALE_MINUTES:-60}"
STALE_SECONDS=$(( STALE_MINUTES * 60 ))

# Must run from inside a git repo.
if ! git rev-parse --git-dir >/dev/null 2>&1; then
  echo "prune-worktrees: not inside a git repo" >&2
  exit 1
fi

# Step 1: let git clean up worktrees whose directories no longer exist.
if [ "$DRY_RUN" = "1" ]; then
  echo "[dry-run] git worktree prune"
else
  git worktree prune
fi

# Step 2: collect zkflow/* worktrees and remove stale ones.
NOW=$(date +%s)
REMOVED=0
SKIPPED=0

# git worktree list --porcelain emits blocks like:
#   worktree /path/to/dir
#   HEAD <sha>
#   branch refs/heads/<name>
#   (blank line)
# Parse into path+branch pairs.
worktree_path=""
worktree_branch=""

while IFS= read -r line; do
  if [[ "$line" == worktree\ * ]]; then
    worktree_path="${line#worktree }"
    worktree_branch=""
  elif [[ "$line" == branch\ * ]]; then
    worktree_branch="${line#branch refs/heads/}"
  elif [[ -z "$line" && -n "$worktree_path" ]]; then
    # End of block — process it.
    if [[ "$worktree_branch" == zkflow/* ]]; then
      # Check age via mtime of HEAD file in the worktree's gitdir, or the
      # worktree directory itself if HEAD file is absent.
      age_target="$worktree_path"
      if [ -d "$worktree_path/.git" ]; then
        age_target="$worktree_path/.git/HEAD"
      elif [ -f "$worktree_path" ]; then
        age_target="$worktree_path"
      fi

      # Use stat -f %m (macOS) with fallback to stat -c %Y (Linux).
      mtime=$( (stat -f %m "$age_target" 2>/dev/null || stat -c %Y "$age_target" 2>/dev/null) || echo "$NOW" )
      age=$(( NOW - mtime ))

      if [ "$age" -ge "$STALE_SECONDS" ]; then
        if [ "$DRY_RUN" = "1" ]; then
          echo "[dry-run] would remove stale worktree: $worktree_path (branch=$worktree_branch, age=${age}s)"
        else
          echo "removing stale worktree: $worktree_path (branch=$worktree_branch, age=${age}s)"
          git worktree remove --force "$worktree_path" 2>/dev/null || true
        fi
        REMOVED=$(( REMOVED + 1 ))
      else
        SKIPPED=$(( SKIPPED + 1 ))
      fi
    fi
    worktree_path=""
    worktree_branch=""
  fi
done < <(git worktree list --porcelain; echo "")

if [ "$DRY_RUN" = "1" ]; then
  echo "[dry-run] would remove: $REMOVED zkflow/* worktree(s); $SKIPPED still-fresh skipped"
else
  echo "prune-worktrees: removed $REMOVED stale zkflow/* worktree(s); $SKIPPED still-fresh skipped"
fi
