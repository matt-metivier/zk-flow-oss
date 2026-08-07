// src/fragments/context-pack.js
// The three durable context signals — machine persona, prior beads, vault Map of
// Contents — in ONE fast-tier agent call, for workflows that have no discover phase.
//
// Why this exists: all three rode the discover phase, and 13 of 18 workflows do not
// have one. Measured before writing this: persona reached 4 workflows, MoC reached the
// discover prompt only, and bdBoundedContext — the bounded cross-run bead retrieval
// helper — was called from nowhere but bd-memory.js itself. /investigate is the sharpest
// case: the workflow that most needs machine facts (which DC, which Grafana, which repo)
// had none of them.
//
// Same contract as selectAndRenderSkills: one call, returns a prompt block, and NEVER
// throws. A workflow that had no context before must not start failing because context
// retrieval was unlucky.
//
// Requires in bundle scope (declare in @@USE): bd-memory (bdBoundedContext),
// model-tiers (MODEL_TIERS).
import { bdBoundedContext } from './bd-memory.js';

// Per-section caps. This block is injected into EVERY phase prompt of a wired workflow,
// so the cost is paid per agent call, not per run. operating-posture has a hard 1800-char
// budget for the same reason — and it rejected an addition of mine earlier this session,
// which is the behaviour we want here too.
export const CONTEXT_BUDGETS = {
  persona: 1200,   // chars — the operator/machine facts an agent cannot infer from code
  beads: 900,      // chars — prior runs on this subject, not a full board dump
  moc: 700,        // chars — the matching KB entry, not the whole vault index
  total: 3000,
};

export const CONTEXT_PACK_SCHEMA = {
  type: 'object',
  required: ['persona', 'beads', 'moc'],
  properties: {
    persona: { type: 'string', description: 'Machine/operator facts relevant to THIS task. Empty string when no persona resolves.' },
    beads: { type: 'string', description: 'Prior runs touching this subject: id, title, outcome. Empty when none.' },
    moc: { type: 'string', description: 'The matching Map of Contents entry plus the note paths it points at. Empty when no MOC matches.' },
    moc_consulted: { type: 'string', description: 'Which MOC file was read, or no_moc_match.' },
    host: { type: 'string' },
  },
};

export function buildContextPackPrompt(requestText, keyword) {
  const kw = (keyword || requestText || '').toString().slice(0, 120);
  return [
    'Gather durable context for the task below. Do NOT do the task. Read-only.',
    '',
    '1. Host + persona: host = trimmed `bd config get host`, else `hostname -s`. Read',
    '   "$ZK_ARTIFACTS_DIR/skills/agent/machines/<host>/persona.md" plus any sibling',
    '   observability.md / RULES.md. Return ONLY the facts that bear on THIS task —',
    '   the repos involved, their conventions and gotchas, the relevant credentials or',
    '   connectivity constraints, the people who own it. Not the whole file.',
    `   Hard cap ${CONTEXT_BUDGETS.persona} characters. Empty string if no persona exists.`,
    '',
    '2. Prior beads: run this and summarise what actually relates to the task —',
    '```',
    bdBoundedContext(kw, { nSame: 5, nCross: 3 }),
    '```',
    '   For each relevant bead give id, one-line title, and its outcome or where it',
    '   stalled. Prior grader feedback on the same subject is the most valuable part.',
    `   Hard cap ${CONTEXT_BUDGETS.beads} characters. Empty string if nothing relates —`,
    '   an unrelated bead is worse than none, it will be treated as precedent.',
    '',
    '3. Map of Contents: `ls "$ZK_ARTIFACTS_DIR/vault/Map of Contents/"`, pick the KB',
    '   matching this task\'s domain, read it, and return the entries plus note paths',
    '   that bear on the task. Set moc_consulted to the filename, or no_moc_match.',
    `   Hard cap ${CONTEXT_BUDGETS.moc} characters.`,
    '',
    'Return JSON matching CONTEXT_PACK_SCHEMA: { persona, beads, moc, moc_consulted, host }.',
    'Prefer empty over speculative: every line you return is injected into a downstream',
    'agent prompt and will be treated as established fact.',
    '',
    `Task: ${(requestText || '').toString().slice(0, 500) || '(infer from context)'}`,
  ].join('\n');
}

// Truncates to the budget on a word boundary, marking the cut so a downstream agent
// knows the section is partial rather than complete.
export function clampSection(text, max) {
  const s = (text || '').toString().trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const lastBreak = Math.max(cut.lastIndexOf('\n'), cut.lastIndexOf('. '));
  return (lastBreak > max * 0.6 ? cut.slice(0, lastBreak) : cut).trimEnd() + ' […truncated to budget]';
}

// Formats a context-pack result into a prompt block. Exported separately so the
// budget behaviour is unit-testable without an agent call.
export function formatContextPack(pack) {
  if (!pack) return '';
  const persona = clampSection(pack.persona, CONTEXT_BUDGETS.persona);
  const beads = clampSection(pack.beads, CONTEXT_BUDGETS.beads);
  const moc = clampSection(pack.moc, CONTEXT_BUDGETS.moc);
  if (!persona && !beads && !moc) return '';
  const parts = ['\n\n## Durable context (machine, prior runs, knowledge base)'];
  if (persona) parts.push(`\n### Machine / operator${pack.host ? ` — ${pack.host}` : ''}\n${persona}`);
  if (beads) parts.push(`\n### Prior runs on this subject\n${beads}\nTreat these as precedent to check, not as fact: a prior run can have been wrong.`);
  if (moc) parts.push(`\n### Knowledge base${pack.moc_consulted ? ` — ${pack.moc_consulted}` : ''}\n${moc}`);
  return parts.join('\n');
}

// One fast-tier call. Returns '' on any failure — additive context must never break a
// workflow that ran without it before.
export async function contextPack(requestText, keyword, modelTier) {
  const request = (requestText || '').toString().trim();
  if (!request && !keyword) return '';
  try {
    const pack = await agent(buildContextPackPrompt(request, keyword), {
      label: 'context:pack',
      agentType: 'researcher',
      schema: CONTEXT_PACK_SCHEMA,
      model: modelTier || MODEL_TIERS.fast,
    });
    return formatContextPack(pack);
  } catch (e) {
    console.warn(`[context-pack] failed (continuing without durable context): ${e.message}`);
    return '';
  }
}
