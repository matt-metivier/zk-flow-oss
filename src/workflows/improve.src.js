// src/workflows/improve.src.js
// @@USE: schemas,bd-memory,args,model-tiers,env-check,handoff,prompt-loader
export const meta = {
  name: 'improve',
  description: 'Manual improvement pipeline: analyze feedback beads -> propose -> verify -> grade -> stage as git branch. Never auto-merges.',
  phases: [{title:'Analyze'},{title:'Reflect'},{title:'Verify'},{title:'Grade'},{title:'Stage'}],
};
// @@FRAGMENTS@@

const a = readArgs(args);

// Guard: bd must be initialized (run: bd init in this directory if not)
const _bdPreflight = await agent(BD_PREFLIGHT_PROMPT, { label: 'preflight:bd', agentType: 'researcher', model: MODEL_TIERS.fast });
if (!_bdPreflight || _bdPreflight.ok === false) {
  const _bdReason = (_bdPreflight && _bdPreflight.reason) || 'bd not initialized — run: cd ~/dev/zk-flow && bd init';
  await agent(handoffPrompt(_bdReason, 'Run: cd ~/dev/zk-flow && bd init, then retry.'), { label: 'handoff:bd-missing', agentType: 'researcher', model: MODEL_TIERS.fast });
  return { verdict: 'needs_human', phase: 'bd-preflight' };
}

const window = a.window || '12h';
const autoApprove = a.autoApprove ? a.autoApprove.split(',').map(s => s.trim()) : [];
const siBeadId = 'improve';

async function persistSI(type, payload) {
  await agent(`Persist run memory. Run EXACTLY this shell, then report done:\n\`\`\`\n${bdWrite(siBeadId, type, payload)}\n\`\`\``, { label: `persist:${type.toLowerCase()}`, agentType: 'researcher', model: MODEL_TIERS.fast });
}

// --- ANALYZE FEEDBACK ---
phase('Analyze');
const feedbackAnalysis = await agent(
  `${postureFor('research', a)}\n\nAnalyze-feedback: read beads via '${bdReady(null)}' and '${bdShow(siBeadId)}'. Cluster GraderFeedback events by phase, rubric, and skill over the last ${window}. Count events. If fewer than 5 feedback events are found, return { skipped: 'below threshold', count: <n> }. Otherwise return clusters with pattern summaries.`,
  { label: 'analyze-feedback:1', agentType: 'evidence-scanner', model: modelFor('research', a) }
);

if (feedbackAnalysis && feedbackAnalysis.skipped) {
  return { skipped: feedbackAnalysis.skipped, count: feedbackAnalysis.count };
}

await persistSI('FeedbackAnalysis', feedbackAnalysis);

// --- REFLECT: generate proposals ---
phase('Reflect');
const reflection = await agent(
  loadPhasePrompt('self-improvement', { request: JSON.stringify(feedbackAnalysis) }),
  { agentType: 'reflector', label: 'reflector:1', model: modelFor('research', a) }
);

await persistSI('Reflection', reflection);

// --- VERIFY: filter disallowed proposals ---
phase('Verify');
const verified = await agent(
  `${postureFor('verify', a)}\n\nProposal-verifier: review these proposals and filter out any that: (1) violate Iron Law constraints, (2) if $ZK_ARTIFACTS_DIR/protected.json exists - target protected skills listed there (treat absent file as empty protected list, do not fail), or (3) are trivial/noise. Return only actionable, safe proposals. Proposals: ${JSON.stringify(reflection)}`,
  { label: 'proposal-verifier:1', agentType: 'proposal-verifier', model: modelFor('research', a) }
);

if (!verified || (Array.isArray(verified) ? verified.length === 0 : !verified.proposals?.length)) {
  return { verdict: 'no_actionable_proposals', analysis: feedbackAnalysis };
}

await persistSI('VerifiedProposals', verified);

// --- GRADE proposals ---
phase('Grade');
const graded = await agent(
  `${postureFor('grade', a)}\n\nGrader: evaluate the quality and priority of these proposals. Score each by: impact, safety, effort. Rank them. Proposals: ${JSON.stringify(verified)}`,
  { schema: SCHEMAS.review, agentType: 'grader', label: 'grader:proposals', model: modelFor('grade', a) }
);

await persistSI('GradedProposals', graded);
// Emit GraderFeedback so future improve runs can cluster by phase/verdict
await persistSI('GraderFeedback', { phase: 'improve', verdict: graded && graded.verdict, findings: graded });

// --- STAGE as git branch ---
phase('Stage');
const proposals = Array.isArray(verified) ? verified : (verified.proposals || []);
const branchName = `proposals/improve-${Date.now()}`;

const staged = await agent(
  `Stage these improvement proposals as a git branch named '${branchName}'. For each proposal:
1. Run: git checkout -b ${branchName} (first proposal only)
2. Write proposals/<target>.json with the proposal content
3. git add proposals/<target>.json && git commit -m "proposal: <target> - <summary>"
4. NEVER auto-merge to main.
5. Auto-approve only these mutation types if present in autoApprove list: ${JSON.stringify(autoApprove)}. All others require human review.
Proposals to stage: ${JSON.stringify(proposals)}.
Return: { branch: '${branchName}', staged: [list of filenames], skipped: [list not auto-approved] }.
After staging, write a handoff doc to $TMPDIR per the handoff skill: proposals staged for human review, branch: ${branchName}.`,
  { agentType: 'pr-author', label: 'stage:proposals', model: modelFor('persist', a) }
);

return {
  verdict: 'staged',
  branch: branchName,
  proposals: proposals.length,
  graded,
  staged,
};
