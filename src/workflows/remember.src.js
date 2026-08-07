// src/workflows/remember.src.js
// @@USE: handoff,schemas,args,bd-memory,bead-run,model-tiers,env-check,operating-posture
export const meta = {
  name: 'remember',
  description: 'Daily handoff loader: pull + read yesterday\'s DailyDigest beads across all hosts and narrate where each machine left off so you can continue. Pairs with scripts/daily-accumulate.sh (Stop hook) + scripts/daily-rollup.sh (launchd timer). Optional date=YYYY-MM-DD to load a specific day.',
  phases: [{title:'Resume'}],
};
// @@FRAGMENTS@@

const a = readArgs(args);

// Guard: bd must be initialized (cloned from dashboard.src.js BD_PREFLIGHT_PROMPT path)
phase('Resume');

const _bdPreflight = await agent(BD_PREFLIGHT_PROMPT, { label: 'preflight:bd', agentType: 'researcher', model: MODEL_TIERS.fast });
if (!_bdPreflight || _bdPreflight.ok === false) {
  const _bdReason = (_bdPreflight && _bdPreflight.reason) || 'bd not initialized — run: cd ~/dev/zk-flow && bd init';
  await agent(handoffPrompt(_bdReason, 'Run: cd ~/dev/zk-flow && bd init, then retry.'), { label: 'handoff:bd-missing', agentType: 'researcher', model: MODEL_TIERS.fast });
  return { verdict: 'needs_human', phase: 'bd-preflight' };
}

// Sandbox bans Date/process — the agent computes the target day in its shell.
// date= overrides (explicit YYYY-MM-DD); else yesterday via OS-portable date arithmetic.
const dayArg = a.date ? `Use this exact day: ${a.date}` : 'Compute YESTERDAY as Y (run: date -v-1d +%Y-%m-%d 2>/dev/null || date -d yesterday +%Y-%m-%d).';

const RESUME_SCHEMA = {
  type: 'object',
  required: ['found', 'summary'],
  properties: {
    found: { type: 'boolean' },
    day: { type: 'string' },
    hosts: { type: 'array', items: { type: 'string' } },
    open_loops: { type: 'array', items: { type: 'object' } },
    summary: { type: 'string' },
  },
};

// Run bead-based resume + ctx_search in parallel — richer handoff context at no extra latency.
const [resume, ctxHints] = await parallel([
  () => agent(
    `${postureFor('research', a)}\n\n` +
    `Load the daily handoff and narrate where work left off so the operator can continue.\n\n` +
    `## Steps (run the shell from the zk-flow workspace; do not answer from memory)\n` +
    `1. Sync beads from the other machines: \`cd "\${ZK_FLOW_DIR:-$HOME/dev/zk-flow}" && git pull --rebase 2>/dev/null || true\` (DailyDigest beads ride refs/dolt/data on the git remote).\n` +
    `2. ${dayArg}\n` +
    `3. Enumerate every host's digest for that day:\n` +
    `   \`cd "\${ZK_FLOW_DIR:-$HOME/dev/zk-flow}" && bd list --label daily-digest --created-after "$Y" --json\`\n` +
    `4. For EACH returned bead id, read its latest DailyDigest entry:\n` +
    `   \`bd comments <id> | grep 'DailyDigest:' | tail -1\` (the JSON is after the prefix).\n` +
    `5. Merge per-host: list which machine touched which beads, the commits, and the combined open_loops (beads still in_progress). De-dupe open_loops by id across hosts.\n` +
    `6. Narrate a short handoff: what was in flight on each machine, the combined open loops, and the obvious next action. If NO digest beads exist for the day, set found=false and say so plainly (no prior context — start fresh).\n\n` +
    `Emit JSON matching the schema: found, day (the resolved date), hosts[], open_loops[], summary (the narrated handoff).`,
    { schema: RESUME_SCHEMA, agentType: 'researcher', label: 'resume:load', model: modelFor('research', a) }
  ),
  () => agent(
    'Search the context-mode knowledge base for recent session context to enrich the daily handoff. ' +
    'Call mcp__plugin_context-mode_context-mode__ctx_search with queries: ' +
    '["daily handoff open work in progress", "recent workflow runs beads", "zk-flow k8s operators work"]. ' +
    'Return a concise bullet list (≤150 words) of the most relevant snippets found. ' +
    'If nothing useful is found, return an empty string — do not fabricate context.',
    { label: 'resume:ctx-search', agentType: 'researcher', model: MODEL_TIERS.fast }
  ),
]);

const ctxSection = (ctxHints && ctxHints.trim()) ? `\n\n## Context-mode session hints\n${ctxHints}` : '';
return {
  verdict: 'resume_complete',
  found: !!(resume && resume.found),
  day: resume && resume.day,
  summary: (resume && resume.summary || '') + ctxSection,
  open_loops: (resume && resume.open_loops) || [],
};
