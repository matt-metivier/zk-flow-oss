// @@USE: run-phase,handoff,budgets,schemas,args,bead-run,model-tiers,env-check,prompt-loader
export const meta = {
  name: 'debug',
  description: 'Debug lifecycle: reproduce+root-cause -> fix -> test. Diagnoses a reported bug to ROOT CAUSE, then fixes it. Tighter than bugfix: starts from a symptom.',
  phases: [{title:'Reproduce'},{title:'RootCause'},{title:'Fix'},{title:'Test'}],
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

const beadId = runBeadId(a);

// --- REPRODUCE + ROOT CAUSE ---
phase('Reproduce');
phase('RootCause');
const rootCause = await runPhase({
  phasePrompt: (i, fb) => loadPhasePrompt('research', { iteration: i, feedback: fb || null, request: 'ROOT CAUSE: ' + (a.brief || (a._ ? a._.join(' ') : '(infer from context)')) }),
  phaseSchema: SCHEMAS.research,
  agentType: 'researcher',
  label: 'rootcause',
  phaseName: 'research',
  maxIterations: PHASE_BUDGETS.research,
  model: modelFor('research', a), gradeModel: modelFor('grade', a),
  posture: postureFor('research', a),
  beadId: beadId,
  gradePrompt: (out) => `Grade this root-cause analysis: reject (REQUEST_CHANGES) if evidence_quality is 'weak' or root cause lacks file:line proof. Output: ${JSON.stringify(out)}`,
});
if (!rootCause.ok) {
  await agent(handoffPrompt('root-cause analysis did not pass within budget', 'rerun /debug or gather more reproduction evidence'), { agentType: 'pr-author', label: 'handoff:rootcause', model: modelFor('persist', a) });
  return { verdict: 'needs_human', phase: 'rootcause' };
}
await persistPhase(beadId, 'RootCause', rootCause.out);

// --- FIX ---
phase('Fix');
const fixResult = await runPhase({
  phasePrompt: (i, fb) => loadPhasePrompt('implementation', { iteration: i, feedback: fb || null, request: (a.brief || (a._ ? a._.join(' ') : '')), research: rootCause.out }),
  phaseSchema: SCHEMAS.implementation,
  agentType: 'scope-locked-editor',
  label: 'fix',
  phaseName: 'implementation',
  maxIterations: PHASE_BUDGETS.impl,
  model: modelFor('impl', a), gradeModel: modelFor('grade', a),
  posture: postureFor('impl', a),
  beadId: beadId,
  gradePrompt: (out) => `Grade this fix against the implementation rubric: verify it targets the root cause (not just the symptom), and that a regression test is included. Output: ${JSON.stringify(out)}`,
});
if (!fixResult.ok) {
  await agent(handoffPrompt('fix did not pass within budget', 'rerun /debug or investigate manually'), { agentType: 'pr-author', label: 'handoff:fix', model: modelFor('persist', a) });
  return { verdict: 'needs_human', phase: 'fix' };
}
await persistPhase(beadId, 'Fix', fixResult.out);

// --- TEST ---
phase('Test');
const testResult = await runPhase({
  phasePrompt: (i, fb) => loadPhasePrompt('testing', { iteration: i, feedback: fb || null, request: (a.brief || (a._ ? a._.join(' ') : '')), design: fixResult.out }),
  phaseSchema: SCHEMAS.testing,
  agentType: 'test-runner',
  label: 'testing',
  maxIterations: PHASE_BUDGETS.testing,
  model: modelFor('testing', a), gradeModel: modelFor('grade', a),
  posture: postureFor('testing', a),
  beadId: beadId,
  gradePrompt: (out) => `Grade this test run: confirm the original symptom is gone and the regression test passes. Output: ${JSON.stringify(out)}`,
});
if (!testResult.ok) {
  await agent(handoffPrompt('testing did not pass within budget', 'rerun /debug or investigate test failures manually'), { agentType: 'pr-author', label: 'handoff:testing', model: modelFor('persist', a) });
  return { verdict: 'needs_human', phase: 'testing' };
}
await persistPhase(beadId, 'Test', testResult.out);

await persistSolution((a.brief || (a._ ? a._.join(' ') : 'debug')), rootCause.out && rootCause.out.synthesis, { request: a.brief || '', beadId });
return { verdict: 'APPROVE', bead: beadId };
