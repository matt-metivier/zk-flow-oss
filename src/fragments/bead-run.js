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
  return agent(`Persist run memory. Run EXACTLY this shell, then report done:\n\`\`\`\n${bdWrite(beadId, type, payload)}\n\`\`\``, { label: 'persist:' + type.toLowerCase(), agentType: 'persist', model: MODEL_TIERS.fast });
}

// Writes a solution summary to vault/Solutions/ so future discover phases can find it.
// Call after successful workflow completion with the key artifacts.
export async function persistSolution(label, summary, { request, approach, files = [], beadId = null } = {}) {
  const dir = process.env.ZK_ARTIFACTS_DIR;
  if (!dir) return; // silent no-op if vault not available
  const slug = label.replace(/[^a-z0-9-]/gi, '-').replace(/-+/g, '-').toLowerCase().slice(0, 50);
  const date = new Date().toISOString().slice(0, 10);
  const fname = `${date}-${slug}.md`;
  const content = [
    `# ${label}`,
    `Date: ${date}`,
    beadId ? `Bead: ${beadId}` : '',
    '',
    '## Request',
    request || '',
    '',
    '## Approach',
    approach || summary || '',
    '',
    files.length ? `## Key files\n${files.map(f => '- ' + f).join('\n')}` : '',
  ].filter(l => l !== undefined).join('\n').trim();
  const shellCmd = `mkdir -p "$ZK_ARTIFACTS_DIR/vault/Solutions" && cat > "$ZK_ARTIFACTS_DIR/vault/Solutions/${fname}" << 'SOLEOF'\n${content}\nSOLEOF`;
  return agent(`Write solution to vault. Run EXACTLY:\n\`\`\`\n${shellCmd}\n\`\`\``, { label: 'persist:solution', agentType: 'persist', model: MODEL_TIERS.fast });
}
