// @@USE: run-phase,backtrack,handoff,budgets,schemas,args,bead-run,model-tiers,env-check,prompt-loader,guardrails,bd-memory,operating-posture,skill-render,context-pack
export const meta = {
  name: 'debug',
  description: 'Debug lifecycle: reproduce+root-cause -> fix -> test. Diagnoses a reported bug to ROOT CAUSE, then fixes it. tighter than small-feature: starts from a symptom.',
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
const _request = a.brief || (a._ ? a._.join(' ') : '');

// Domain skills for the whole run. /debug has no discover phase, so every phase
// agent used to run with zero repo/domain guidance (no infra-salt conventions, no
// language skill, no gotchas layer). One fast-tier call, reused by all three phases.
const skillsBlock = await selectAndRenderSkills(_request, null, modelFor('discover', a));

// Durable context: machine persona + prior beads + vault MOC. This workflow has no
// discover phase, so none of the three reached its agents before.
const ctxBlock = await contextPack(_request, _request, modelFor('discover', a));

// --- REPRODUCE + ROOT CAUSE ---
phase('Reproduce');
phase('RootCause');
// backtrackSeed: when the fix phase backtracks, the prior fix-failure feedback is
// folded into the root-cause request so the re-derivation is informed.
const runRootCause = (backtrackSeed) => runPhase({
  phasePrompt: (i, fb) => loadPhasePrompt('research', { skills: skillsBlock, context: ctxBlock, iteration: i, feedback: fb || null, request: 'ROOT CAUSE (follow superpowers:systematic-debugging — reproduce, isolate, form a hypothesis, then VERIFY the root cause with file:line evidence BEFORE proposing any fix): ' + (a.brief || (a._ ? a._.join(' ') : '(infer from context)')) + (backtrackSeed ? `\n\nPrior fix attempt failed; re-derive the root cause with this in mind: ${backtrackSeed}` : '') }),
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
let rootCause = await runRootCause(null);
if (!rootCause.ok) {
  await agent(handoffPrompt('root-cause analysis did not pass within budget', 'rerun /debug or gather more reproduction evidence'), { agentType: 'pr-author', label: 'handoff:rootcause', model: modelFor('persist', a) });
  return { verdict: 'needs_human', phase: 'rootcause' };
}
await persistPhase(beadId, 'RootCause', rootCause.out);

// --- FIX ---
phase('Fix');
// runFix reads rootCause.out at call time, so a backtracked re-derivation flows in.
const runFix = () => runPhase({
  phasePrompt: (i, fb) => loadPhasePrompt('implementation', { skills: skillsBlock, context: ctxBlock, iteration: i, feedback: fb || null, request: _request, research: rootCause.out }),
  phaseSchema: SCHEMAS.implementation,
  agentType: 'scope-locked-editor',
  isolation: 'worktree',
  label: 'fix',
  phaseName: 'implementation',
  maxIterations: PHASE_BUDGETS.impl,
  model: modelFor('impl', a), gradeModel: modelFor('grade', a),
  posture: postureFor('impl', a),
  beadId: beadId,
  gradePrompt: (out) => `Grade this fix against the implementation rubric: verify it targets the root cause (not just the symptom), and that a regression test is included. Output: ${JSON.stringify(out)}`,
});
// Backtrack: if the fix exhausts its budget, re-derive root cause (once per backtrack
// budget) before needs_human. PHASE_BUDGETS.backtrack defaults to 0 = pass-through.
const reRootCause = async (fb) => { rootCause = await runRootCause(fb); return rootCause; };
const fixResult = await runWithBacktrack(reRootCause, runFix, { budget: PHASE_BUDGETS.backtrack, label: 'fix' });
if (!fixResult.ok) {
  await agent(handoffPrompt('fix did not pass within budget', 'rerun /debug or investigate manually'), { agentType: 'pr-author', label: 'handoff:fix', model: modelFor('persist', a) });
  return { verdict: 'needs_human', phase: 'fix' };
}
await persistPhase(beadId, 'Fix', fixResult.out);

// --- TEST ---
phase('Test');
const testResult = await runPhase({
  phasePrompt: (i, fb) => loadPhasePrompt('testing', { skills: skillsBlock, context: ctxBlock, iteration: i, feedback: fb || null, request: _request, design: fixResult.out }),
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
