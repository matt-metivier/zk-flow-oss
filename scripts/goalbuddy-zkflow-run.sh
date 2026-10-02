#!/usr/bin/env bash
# scripts/goalbuddy-zkflow-run.sh — thin shell wrapper over goalbuddy-zkflow-run.mjs.
#
# Lets a GoalBuddy goal_worker drive a zk-flow CORE workflow non-interactively
# (via `claude -p`) and harvest the run's ProofOfWork bead as a
# goalbuddy_receipt_v1 receipt. All real logic (workflow selection, autoApprove
# injection, ProofOfWork->receipt extraction) lives in the .mjs so it is
# unit-testable without spawning claude or bd.
#
# It forwards args verbatim (incl. --auto / --provision / --no-provision /
# --cleanup / --no-cleanup) — node's argv preserves shell-quoted values, so
#   goalbuddy-zkflow-run.sh workflow=feature brief="add rate limiting"
# arrives as a single brief token. --auto passes
# --dangerously-skip-permissions to claude so unattended file writes do not
# block on a permission prompt; without it the run uses
# --permission-mode acceptEdits.
#
# Usage:
#   scripts/goalbuddy-zkflow-run.sh --help
#   scripts/goalbuddy-zkflow-run.sh --dry-run workflow=feature brief="hello"
#   scripts/goalbuddy-zkflow-run.sh --auto workflow=debug bead=zk-flow-login-bug
#   scripts/goalbuddy-zkflow-run.sh workflow=finish-pr pr=https://github.com/o/r/pull/7 bead=zk-flow-pr-7
#   # drive /finish-pr in a target repo with no .claude/ (auto-provisioned, LOCAL-ONLY):
#   scripts/goalbuddy-zkflow-run.sh --auto --provision workflow=finish-pr pr=40 \
#       bead=minions-pr40-finishpr cwd=/Users/me/dev/minions
set -euo pipefail

command -v node >/dev/null || { echo "goalbuddy-zkflow-run: need node on PATH" >&2; exit 2; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Forward all args verbatim, including --auto (-> --dangerously-skip-permissions).
exec node "$SCRIPT_DIR/goalbuddy-zkflow-run.mjs" "$@"
