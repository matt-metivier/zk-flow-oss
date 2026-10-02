// src/fragments/handoff.js
// Pure helper that builds a handoff prompt for an agent to write a handoff document.
export function handoffPrompt(summary, suggestedNext) {
  return `Write a handoff document to $TMPDIR per the handoff skill ` +
    `($ZK_ARTIFACTS_DIR/skills/general/practices/handoff/SKILL.md). ` +
    `Summary of where things stand: ${summary} ` +
    `Suggested next step: ${suggestedNext}. ` +
    `Reference artifacts by path or bead id (do not duplicate); redact secrets.`;
}
