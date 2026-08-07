// src/fragments/env-check.js
// Guards: fail fast with handoff if required env/tools are missing.
export function requireZkArtifacts() {
  // The Workflow sandbox has no Node APIs (process is undefined). Agents inherit
  // the real shell env, so defer validation to agent-side preflights there.
  if (typeof process === 'undefined' || !process.env) {
    return { missing: false, dir: '$ZK_ARTIFACTS_DIR', deferred: true };
  }
  const dir = process.env.ZK_ARTIFACTS_DIR;
  if (!dir || dir.trim() === '') {
    return {
      missing: true,
      message: 'ZK_ARTIFACTS_DIR is not set. Vault and skills search will not work. ' +
        'Set it in your shell profile: export ZK_ARTIFACTS_DIR="$HOME/dev/zk-artifacts" ' +
        'then source the profile or open a new terminal.'
    };
  }
  return { missing: false, dir };
}

// Returns a prompt to verify skills are discoverable (glob returns >0 results).
export const SKILLS_PREFLIGHT_PROMPT =
  'skills-preflight check. Run: ' +
  'DIR="${ZK_ARTIFACTS_DIR:-}"; ' +
  'COUNT=$(find "$DIR/skills" -name "SKILL.md" 2>/dev/null | wc -l | tr -d \' \'); ' +
  'if [ -z "$DIR" ] || [ "$COUNT" = "0" ]; then ' +
  'echo \'{"ok":false,"reason":"ZK_ARTIFACTS_DIR/skills/ empty or unreadable"}\'; ' +
  'else echo \'{"ok":true,"count":\'"$COUNT"\'}\'; fi. ' +
  'Emit exactly that JSON as your final message.';

// Returns a pre-flight prompt for a fast-tier agent to verify bd is initialized.
// Agent must emit { ok: true } or { ok: false, reason: string }.
export const BD_PREFLIGHT_PROMPT =
  `bd-preflight check. Run: cd "\${ZK_FLOW_DIR:-$HOME/dev/zk-flow}" && bd ready 2>&1; exit_code=$?; ` +
  `if [ $exit_code -ne 0 ]; then echo '{"ok":false,"reason":"bd not initialized — run: cd ~/dev/zk-flow && bd init"}'; ` +
  `else echo '{"ok":true}'; fi. ` +
  `Emit exactly that JSON as your final message.`;
