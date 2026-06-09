// @@USE: run-phase,handoff,budgets,schemas,args,bead-run,model-tiers,env-check,guardrails,prompt-loader
export const meta = {
  name: 'refactor',
  description: 'Refactor lifecycle: discover -> research -> refactor -> test. Restructures code WITHOUT behavior change.',
  phases: [{title:'Discover'},{title:'Research'},{title:'Refactor'},{title:'Test'}],
};
// @@FRAGMENTS@@

const a = readArgs(args);

// Guard: ZK_ARTIFACTS_DIR required for vault/skills search (discover phase)
const _zkCheck = requireZkArtifacts();
if (_zkCheck.missing) {
  await agent(handoffPrompt(_zkCheck.message, 'Set ZK_ARTIFACTS_DIR in shell profile, source it, then retry.'), { label: 'handoff:missing-env', agentType: 'researcher', model: modelFor('persist', a) });
  return { verdict: 'needs_human', phase: 'env-check' };
}

// Guard: bd must be initialized (run: bd init in this directory if not)
const _bdPreflight = await agent(BD_PREFLIGHT_PROMPT, { label: 'preflight:bd', agentType: 'researcher', model: MODEL_TIERS.fast });
if (!_bdPreflight || _bdPreflight.ok === false) {
  const _bdReason = (_bdPreflight && _bdPreflight.reason) || 'bd not initialized — run: cd ~/dev/zk-flow && bd init';
  await agent(handoffPrompt(_bdReason, 'Run: cd ~/dev/zk-flow && bd init, then retry.'), { label: 'handoff:bd-missing', agentType: 'researcher', model: MODEL_TIERS.fast });
  return { verdict: 'needs_human', phase: 'bd-preflight' };
}


const beadId = runBeadId(a);

// --- DISCOVER ---
phase('Discover');
const discovery = await agent(
  `${postureFor('discover', a)}\n\nDiscover the codebase scope for this refactor. Emit skills to load, vault paths relevant to this refactor domain, related bead IDs from prior similar refactors, and rationale. Refactor target: ${a._ ? a._.join(' ') : '(infer from context)'}`,
  { schema: SCHEMAS.discover, agentType: 'researcher', label: 'discover:1', model: modelFor('discover', a) }
);
await persistPhase(beadId, 'Discover', discovery);

// --- RESEARCH ---
phase('Research');
const research = await runPhase({
  phasePrompt: (i, fb) => loadPhasePrompt('research', { iteration: i, feedback: fb || null, request: 'REFACTOR blast-radius mapping: ' + (a._ ? a._.join(' ') : ''), discovery: discovery }),
  phaseSchema: SCHEMAS.research,
  agentType: 'researcher',
  label: 'research',
  maxIterations: PHASE_BUDGETS.research,
  model: modelFor('research', a), gradeModel: modelFor('grade', a),
  posture: postureFor('research', a),
  beadId: beadId,
  gradePrompt: (out) => `Grade this research output for completeness, blast-radius coverage, and call-site enumeration. Reject if any caller/callee is unaccounted for. Output: ${JSON.stringify(out)}`,
});
if (!research.ok) {
  await agent(handoffPrompt('research did not pass within budget', 'rerun /refactor or narrow the refactor target'), { agentType: 'pr-author', label: 'handoff:research', model: modelFor('persist', a) });
  return { verdict: 'needs_human', phase: 'research' };
}
await persistPhase(beadId, 'Research', research.out);
assertEvidencePresent(research.out, 'Research');

// --- REFACTOR ---
phase('Refactor');
const refactorResult = await runPhase({
  phasePrompt: (i, fb) => loadPhasePrompt('implementation', { iteration: i, feedback: fb || null, request: (a._ ? a._.join(' ') : ''), research: research.out, design: discovery, skills: skillsBlock || '' }),
  phaseSchema: SCHEMAS.implementation,
  agentType: 'scope-locked-editor',
  label: 'refactor',
  phaseName: 'implementation',
  maxIterations: PHASE_BUDGETS.impl,
  model: modelFor('impl', a), gradeModel: modelFor('grade', a),
  posture: postureFor('impl', a),
  beadId: beadId,
  gradePrompt: (out) => `Grade this refactor against the implementation rubric AND behavior-preservation: verify all call sites from research are updated, no public contracts changed, no behavior altered. Output: ${JSON.stringify(out)}`,
});
if (!refactorResult.ok) {
  await agent(handoffPrompt('refactor did not pass within budget', 'rerun /refactor or investigate manually'), { agentType: 'pr-author', label: 'handoff:refactor', model: modelFor('persist', a) });
  return { verdict: 'needs_human', phase: 'refactor' };
}
await persistPhase(beadId, 'Refactor', refactorResult.out);

// --- TEST ---
phase('Test');
const targetEnv = a.targetEnv || 'local';
const testResult = await runPhase({
  phasePrompt: (i, fb) => loadPhasePrompt('testing', { iteration: i, feedback: fb || null, request: 'verify UNCHANGED behavior after refactor', design: refactorResult.out, research: research.out }),
  phaseSchema: SCHEMAS.testing,
  agentType: 'test-runner',
  label: 'testing',
  maxIterations: PHASE_BUDGETS.testing,
  model: modelFor('testing', a), gradeModel: modelFor('grade', a),
  posture: postureFor('testing', a),
  beadId: beadId,
  gradePrompt: (out) => `Grade this test run: confirm the suite passes and no test changed semantics. Output: ${JSON.stringify(out)}`,
});
if (!testResult.ok) {
  await agent(handoffPrompt('testing did not pass within budget', 'rerun /refactor or investigate test failures manually'), { agentType: 'pr-author', label: 'handoff:testing', model: modelFor('persist', a) });
  return { verdict: 'needs_human', phase: 'testing' };
}
await persistPhase(beadId, 'Test', testResult.out);

return { verdict: 'APPROVE', bead: beadId };
