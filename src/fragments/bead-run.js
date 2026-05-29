// src/fragments/bead-run.js
// Shared bead-id derivation and phase-persistence helper.
// Used by all lifecycle workflows (feature, bugfix, design, research, test, finish-pr).
// Inlined at build time (no import); no unit tests (agent() is integration-only).
export function runBeadId(a) {
  if (a.bead) {
    // Normalize explicit bead ids so case variants (ABC-123) and URL-ish ids don't throw in assertId.
    // Run-1 and run-2 with the same bead= normalize identically, preserving correlation.
    return String(a.bead).replace(/[^a-z0-9._-]/gi, '-').replace(/^-+/, '').toLowerCase();
  }
  if (a.pr) {
    // Stable pr-derived id so finish-pr (no positional a._) doesn't collapse to 'zkflow-run'.
    return 'zkflow-pr-' + String(a.pr).replace(/[^a-z0-9]/gi, '-').replace(/^-+/, '').toLowerCase();
  }
  const slug = (a._ && a._.length) ? a._.join('-').slice(0, 40).replace(/[^a-z0-9._-]/gi, '-').replace(/^-+/, '').toLowerCase() : 'run';
  return 'zkflow-' + (slug || 'run'); // note: pass bead=<id> to correlate/avoid collisions (sandbox has no nonce)
}
export async function persistPhase(beadId, type, payload) {
  return agent(`Persist run memory. Run EXACTLY this shell, then report done:\n\`\`\`\n${bdWrite(beadId, type, payload)}\n\`\`\``, { label: 'persist:' + type.toLowerCase(), agentType: 'researcher' });
}
