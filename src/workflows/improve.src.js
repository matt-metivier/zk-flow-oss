// src/workflows/improve.src.js
// @@USE: schemas,bd-memory,args,model-tiers,env-check,handoff,prompt-loader,operating-posture
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
const siBeadId = 'zk-flow-improve'; // bd requires the db prefix; bare 'improve' was rejected and run memory scattered to auto-ids

// agentType MUST be 'persist' (bash-only). Dispatched as 'researcher', the agent
// read the payload as a first-person claim about work it had not done and refused:
// "not a legitimate run memory reflection - it's a fabricated attestation".
// That cycle's run memory was silently lost.
async function persistSI(type, payload) {
  await agent(`Persist run memory. Run EXACTLY this shell, then report done:\n\`\`\`\n${bdWrite(siBeadId, type, payload)}\n\`\`\``, { label: `persist:${type.toLowerCase()}`, agentType: 'persist', model: MODEL_TIERS.fast });
}

// --- ANALYZE FEEDBACK ---
phase('Analyze');
const feedbackAnalysis = await agent(
  `${postureFor('research', a)}\n\nAnalyze-feedback: read beads via '${bdReady(null)}' and '${bdShow(siBeadId)}'. Cluster GraderFeedback events by phase, rubric, and skill over the last ${window}.\n\n` +
  `ALSO collect skill_drift[] items from VaultSync bead entries (\`bd list --json\` then \`bd comments <id>\` grepping for 'VaultSync'). /vault-sync detects where a repo skill contradicts the repo's actual code and is deliberately not allowed to edit skills — those items are this workflow's input, not decoration. Each carries { skill_id, item, evidence }; treat one as a first-class gap cluster with the skill already identified and the evidence already gathered, and record its evidence verbatim so the proposal can cite it.\n\n` +
  `Count events = GraderFeedback events + skill_drift items. If fewer than 5 TOTAL, return { skipped: 'below threshold', count: <n> }. Otherwise return clusters with pattern summaries, each tagged source:'grader'|'vault_sync_drift'.`,
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
  // Schema-forced: the Stage phase reads reflection.proposals[]. Unforced, the
  // reflector answered in prose and every downstream read saw undefined.
  { schema: SCHEMAS.reflection, agentType: 'reflector', label: 'reflector:1', model: modelFor('research', a) }
);

await persistSI('Reflection', reflection);

// --- DISTILL: durable learnings -> bd memories ---
// bd remember memories are injected at every future `bd prime`, so a recurring gap
// pattern recorded here informs future discover/research/improve runs without
// re-deriving it. This is the WRITE side of the bd memories lane that zk-flow-xj3's
// bounded/windowed retrieval reads. Soft: a memory-write failure never aborts the run.
await agent(
  `${postureFor('research', a)}\n\nDistill at most 3 DURABLE, cross-session learnings from this improve cycle — recurring gap patterns (phase x rubric x skill) that will still matter next week, NOT run-specific noise. ` +
  `First check existing memories with:\n\`\`\`\n${bdMemories('')}\n\`\`\`\nThen for EACH new learning, run the canonical form EXACTLY ONCE, substituting your own <insight> text and a stable kebab-case <key> (re-using an existing key overwrites rather than duplicates):\n` +
  `\`\`\`\n${bdRemember('<insight>', '<key>')}\n\`\`\`\n` +
  `Skip anything already covered by an existing memory or obvious from the code. Reflection to distill: ${JSON.stringify(reflection)}`,
  { label: 'remember:learnings', agentType: 'researcher', model: modelFor('research', a) }
);

// --- VERIFY: filter disallowed proposals ---
phase('Verify');
// The schema is load-bearing: without it the verifier returned prose wrapping a
// fenced JSON block, the gate below read `.proposals` off a string, and a cycle
// where all 8 proposals were APPROVED still returned no_actionable_proposals.
const verified = await agent(
  `${postureFor('verify', a)}\n\nProposal-verifier: review these proposals and filter out any that: (1) violate Iron Law constraints, (2) if $ZK_ARTIFACTS_DIR/protected.json exists - target protected skills listed there (treat absent file as empty protected list, do not fail), or (3) are trivial/noise. Emit one verdict per proposal, in the order received, with the proposal's first evidence bead as proposal_bead. Proposals: ${JSON.stringify(reflection)}`,
  { schema: SCHEMAS['proposal-verdict'], label: 'proposal-verifier:1', agentType: 'proposal-verifier', model: modelFor('research', a) }
);

// Gate on approved verdicts, not on the envelope being non-empty: a batch that is
// entirely rejections is still a "nothing actionable" cycle, and must not stage.
const approved = (verified?.verdicts || []).filter(v => v.verdict === 'approved');
if (!approved.length) {
  return { verdict: 'no_actionable_proposals', analysis: feedbackAnalysis, verdicts: verified?.verdicts || [] };
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
// Stage only what the verifier approved: match verdicts back to the reflector's
// proposals by evidence bead, and keep the proposal bodies (verdicts carry ids only).
const approvedBeads = new Set(approved.map(v => v.proposal_bead));
const proposals = (reflection.proposals || []).filter(
  p => (p.evidence_beads || []).some(b => approvedBeads.has(b))
);
// The staging agent resolves the timestamp once and echoes the branch it made:
// the script cannot call Date.now() (sandbox), and a `$(date +%s)` literal
// substituted into three separate shell steps produced three different names.
const STAGE_SCHEMA = {
  type: 'object',
  required: ['staged_ok', 'branch', 'staged', 'skipped'],
  properties: {
    staged_ok: { type: 'boolean', description: 'false when no branch/commit was created, for any reason including a refusal to act' },
    branch: { type: 'string', description: 'The resolved branch name as created, timestamp already expanded. Empty string when staged_ok is false.' },
    staged: { type: 'array', items: { type: 'string' }, description: 'Files committed.' },
    skipped: { type: 'array', items: { type: 'string' }, description: 'Proposals deliberately not committed, with the reason each was left out. Normally empty: everything the verifier approved gets staged.' },
    needs_human_apply: { type: 'array', items: { type: 'string' }, description: 'Staged proposals whose mutation_type is outside the autoApprove list, so a human decides whether to apply them. Being on this list does NOT keep a proposal off the branch.' },
    reason: { type: 'string', description: 'Required when staged_ok is false: why nothing was staged.' },
  },
};

// scope-locked-editor, not pr-author: this step authors content files and commits
// them with no PR. pr-author's charter is PR metadata only and it correctly
// REFUSED the job, while the script still reported verdict 'staged'.
//
// autoApprove gates APPLICATION, not staging. Conflating the two meant a default
// run (autoApprove=[]) staged nothing at all: the agent correctly reported
// stage_failed because every mutation_type fell outside an empty allowlist, so
// the pipeline's whole output depended on an opt-in flag nobody passes.
const staged = await agent(
  `Stage these improvement proposals as a git branch. No PR — a human reviews the branch.
1. Resolve the branch name ONCE: ts=$(date +%s); branch="proposals/improve-$ts"; git checkout -b "$branch"
2. For each proposal write proposals/<slug>.json with the proposal content, where <slug> is the target path slugified.
3. git add + git commit -m "proposal: <slug> - <summary>" per proposal.
4. NEVER merge to main and NEVER push. The branch IS the review artifact.
5. Stage EVERY proposal listed below — the verifier already approved them and this branch is never merged automatically, so writing them down is the safe act, not the risky one. autoApprove (${JSON.stringify(autoApprove)}) decides only which are eligible for later automatic APPLICATION: list the mutation types outside it in needs_human_apply[], still committed. Put a proposal in skipped[] only if you cannot write it at all, and say why.
Proposals to stage: ${JSON.stringify(proposals)}.
Report the branch you actually created. If you do not create a branch and commits, set staged_ok false and say why in reason — do not report success for work you did not do.`,
  { schema: STAGE_SCHEMA, agentType: 'scope-locked-editor', label: 'stage:proposals', model: modelFor('persist', a) }
);

// Trust the agent's own report over the phase having run: two prior cycles
// returned verdict 'staged' while the staging agent had created nothing at all.
if (!staged || staged.staged_ok !== true || !staged.branch) {
  return {
    verdict: 'stage_failed',
    reason: (staged && staged.reason) || 'staging agent reported no branch',
    proposals: proposals.length,
    graded,
  };
}

return {
  verdict: 'staged',
  branch: staged.branch,
  proposals: proposals.length,
  graded,
  staged,
};
