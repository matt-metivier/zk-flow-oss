// src/workflows/bugfix.src.js
// @@USE: run-phase,handoff,verdict,budgets,schemas,args,bd-memory,bead-run,ci-loop,model-tiers,env-check,guardrails,skill-render,persona-load
export const meta = {
  name: 'bugfix',
  description: 'Bug fix lifecycle: discover->research->impl->ci->testing. Mirrors feature minus design and review phases.',
  phases: [{title:'Research'},{title:'Discover'},{title:'Impl'},{title:'CI'},{title:'Testing'}],
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

// --- RESEARCH ---
phase('Research');
const research = await runPhase({
  phasePrompt: (i, fb) => `Research iteration ${i}: understand the root cause, reproduction steps, and fix approaches. ${fb ? 'Address prior grader feedback: ' + fb : ''} Bug: ${a._ ? a._.join(' ') : ''}`,
  phaseSchema: SCHEMAS.research,
  agentType: 'researcher',
  label: 'research',
  maxIterations: PHASE_BUDGETS.research,
  model: modelFor('research', a), gradeModel: modelFor('grade', a),
  posture: postureFor('research', a),
  gradePrompt: (out) => `Grade this research output for completeness, evidence quality, and root cause clarity. Output: ${JSON.stringify(out)}`,
});
if (!research.ok) {
  await agent(handoffPrompt('research did not pass within budget', 'rerun /bugfix or refine the bug report'), { agentType: 'pr-author', label: 'handoff:research', model: modelFor('persist', a) });
  return { verdict: 'needs_human', phase: 'research' };
}
await persistPhase(beadId, 'Research', research.out);
assertEvidencePresent(research.out, 'Research');
  const skillsBlock = await renderSkills(discovery.selected_skills, modelFor('research', a));

// --- DISCOVER ---
phase('Discover');
const discovery = await agent(
  `${postureFor('discover', a)}\n\n${buildPersonaSection()}\n\nSelect skills, vault paths, and related beads using research findings and persona context.\nResearch summary: ${JSON.stringify({key_findings: research.out.key_findings, synthesis: research.out.synthesis})}\nRequest(infer from context)'}`,
  { schema: SCHEMAS.discover, agentType: 'researcher', label: 'discover:1', model: modelFor('discover', a) }
);
await persistPhase(beadId, 'Discover', discovery);

// --- IMPL ---
phase('Impl');
let implResult = await runPhase({
  phasePrompt: (i, fb) => `Implementation iteration ${i}: write the fix. ${fb ? 'Address prior grader feedback: ' + fb : ''} Research: ${JSON.stringify(research.out)}. Discovery: ${JSON.stringify(discovery)}. Bug: ${a._ ? a._.join(' ') : ''}`,
  phaseSchema: SCHEMAS.implementation,
  agentType: 'scope-locked-editor',
  label: 'impl',
  maxIterations: PHASE_BUDGETS.impl,
  model: modelFor('impl', a), gradeModel: modelFor('grade', a),
  posture: postureFor('impl', a),
  gradePrompt: (out) => `Grade this implementation for correctness, scope adherence, and test coverage. Output: ${JSON.stringify(out)}`,
});
if (!implResult.ok) {
  await agent(handoffPrompt('impl did not pass within budget', 'rerun /bugfix or investigate manually'), { agentType: 'pr-author', label: 'handoff:impl', model: modelFor('persist', a) });
  return { verdict: 'needs_human', phase: 'impl' };
}
await persistPhase(beadId, 'Impl', implResult.out);

// --- CI ---
phase('CI');
const ciResult = await runCI({ beadId, budget: PHASE_BUDGETS.ci, agentType: 'evidence-scanner', getImplResult: () => implResult, setImplResult: (r) => { implResult = r; }, implRerunGuard: false, persistOnGreen: 'after' });
if (!ciResult.passed) return { verdict: 'needs_human', phase: ciResult.phase };

// --- TESTING ---
phase('Testing');
const testing = await runPhase({
  phasePrompt: (i, fb) => `Testing iteration ${i}: verify the bug is fixed. Run regression tests. ${fb ? 'Address prior grader feedback: ' + fb : ''} Impl: ${JSON.stringify(implResult.out)}. Discovery: ${JSON.stringify(discovery)}.`,
  phaseSchema: SCHEMAS.testing,
  agentType: 'test-runner',
  label: 'testing',
  maxIterations: PHASE_BUDGETS.testing,
  model: modelFor('testing', a), gradeModel: modelFor('grade', a),
  posture: postureFor('testing', a),
  gradePrompt: (out) => `Grade this testing output for coverage, regression safety, and evidence that the bug is fixed. Output: ${JSON.stringify(out)}`,
});
if (!testing.ok) {
  await agent(handoffPrompt('testing did not pass within budget', 'investigate test failures manually'), { agentType: 'pr-author', label: 'handoff:testing', model: modelFor('persist', a) });
  return { verdict: 'needs_human', phase: 'testing' };
}
await persistPhase(beadId, 'Testing', testing.out);
await agent(`Persist GraderFeedback for improve. Run EXACTLY this shell, then report done:\n\`\`\`\n${bdWrite('improve', 'GraderFeedback', { phase: 'testing', verdict: 'APPROVE', findings: testing.out })}\n\`\`\``, { label: 'persist:graderfeedback:testing', agentType: 'researcher', model: modelFor('persist', a) });

return { verdict: 'APPROVE', route: 'done', impl: implResult.out, testing: testing.out };
