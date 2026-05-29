// src/workflows/test.src.js
// @@USE: run-phase,handoff,budgets,schemas,args,bd-memory,bead-run,model-tiers
export const meta = {
  name: 'test',
  description: 'Standalone test strategy workflow: test-research -> test-design -> run. Use against an existing feature or PR to produce and execute a concrete test plan.',
  phases: [{title:'TestResearch'},{title:'TestDesign'},{title:'Run'}],
};
// @@FRAGMENTS@@

const a = readArgs(args);
const targetEnv = a.targetEnv || 'local';
const beadId = runBeadId(a);

// --- TEST RESEARCH ---
phase('TestResearch');
const testResearch = await runPhase({
  phasePrompt: (i, fb) => `Test research iteration ${i}: how should this feature/PR be tested in ${targetEnv}? Identify test scenarios, fixtures, env constraints, edge cases, and risk areas. ${fb ? 'Address prior grader feedback: ' + fb : ''} Target: ${a._ ? a._.join(' ') : '(infer from context)'}`,
  phaseSchema: SCHEMAS.research,
  agentType: 'researcher',
  label: 'test-research',
  maxIterations: PHASE_BUDGETS.research,
  gradePrompt: (out) => `Grade this test research for scenario coverage, fixture completeness, and env constraint accuracy: ${JSON.stringify(out)}`,
});
if (!testResearch.ok) {
  await agent(handoffPrompt('test research did not pass within budget', 'rerun /test or refine the target'), { agentType: 'pr-author', label: 'handoff:test-research', model: modelFor('persist', a) });
  return { verdict: 'needs_human', phase: 'test-research' };
}
await persistPhase(beadId, 'TestResearch', testResearch.out);

// --- TEST DESIGN ---
phase('TestDesign');
const testDesign = await runPhase({
  phasePrompt: (i, fb) => `Test design iteration ${i}: produce a concrete test plan (unit/integration/e2e/manual) for ${targetEnv} from the test research. ${fb ? 'Address prior grader feedback: ' + fb : ''} Test research: ${JSON.stringify(testResearch.out)}`,
  phaseSchema: SCHEMAS.design,
  agentType: 'designer',
  label: 'test-design',
  maxIterations: PHASE_BUDGETS.design,
  gradePrompt: (out) => `Grade this test plan for concreteness, coverage breadth, and executability in ${targetEnv}: ${JSON.stringify(out)}`,
});
if (!testDesign.ok) {
  await agent(handoffPrompt('test design did not pass within budget', 'rerun /test or refine the test research'), { agentType: 'pr-author', label: 'handoff:test-design', model: modelFor('persist', a) });
  return { verdict: 'needs_human', phase: 'test-design' };
}
await persistPhase(beadId, 'TestDesign', testDesign.out);

// --- RUN ---
phase('Run');
const run = await runPhase({
  phasePrompt: (i, fb) => `Test execution iteration ${i}: execute the test plan in ${targetEnv}; capture results, failures, and evidence. ${fb ? 'Address prior grader feedback: ' + fb : ''} Test plan: ${JSON.stringify(testDesign.out)}. Test research: ${JSON.stringify(testResearch.out)}`,
  phaseSchema: SCHEMAS.testing,
  agentType: 'test-runner',
  label: 'run',
  maxIterations: PHASE_BUDGETS.testing,
  gradePrompt: (out) => `Grade this test execution against the testing rubric for coverage, evidence quality, and pass/fail clarity: ${JSON.stringify(out)}`,
});
if (!run.ok) {
  await agent(handoffPrompt('test execution did not pass within budget', 'investigate test failures manually or rerun /test'), { agentType: 'pr-author', label: 'handoff:run', model: modelFor('persist', a) });
  return { verdict: 'needs_human', phase: 'run' };
}
await persistPhase(beadId, 'TestResults', run.out);

return { verdict: 'APPROVE', targetEnv, bead: beadId };
