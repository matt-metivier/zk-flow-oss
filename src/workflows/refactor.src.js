// @@USE: run-phase,handoff,budgets,schemas,args,bd-memory,bead-run,model-tiers
export const meta = {
  name: 'refactor',
  description: 'Refactor lifecycle: discover -> research -> refactor -> test. Restructures code WITHOUT behavior change.',
  phases: [{title:'Discover'},{title:'Research'},{title:'Refactor'},{title:'Test'}],
};
// @@FRAGMENTS@@

const a = readArgs(args);
const beadId = runBeadId(a);

// --- DISCOVER ---
phase('Discover');
const discovery = await agent(
  `Discover the codebase scope for this refactor. Emit skills to load, vault paths relevant to this refactor domain, related bead IDs from prior similar refactors, and rationale. Refactor target: ${a._ ? a._.join(' ') : '(infer from context)'}`,
  { schema: SCHEMAS.discover, agentType: 'researcher', label: 'discover:1', model: modelFor('discover', a) }
);
await persistPhase(beadId, 'Discover', discovery);

// --- RESEARCH ---
phase('Research');
const research = await runPhase({
  phasePrompt: (i, fb) => `Research iteration ${i}: map the blast radius of the refactor. ${fb ? 'Address prior grader feedback: ' + fb : ''} Use CodeGraphContext to find ALL callers/callees of the symbols to change; enumerate every call site; identify behavior-preserving boundaries. Discovery: ${JSON.stringify(discovery)}. Refactor target: ${a._ ? a._.join(' ') : ''}`,
  phaseSchema: SCHEMAS.research,
  agentType: 'researcher',
  label: 'research',
  maxIterations: PHASE_BUDGETS.research,
  model: modelFor('research', a), gradeModel: modelFor('grade', a),
  gradePrompt: (out) => `Grade this research output for completeness, blast-radius coverage, and call-site enumeration. Reject if any caller/callee is unaccounted for. Output: ${JSON.stringify(out)}`,
});
if (!research.ok) {
  await agent(handoffPrompt('research did not pass within budget', 'rerun /refactor or narrow the refactor target'), { agentType: 'pr-author', label: 'handoff:research', model: modelFor('persist', a) });
  return { verdict: 'needs_human', phase: 'research' };
}
await persistPhase(beadId, 'Research', research.out);

// --- REFACTOR ---
phase('Refactor');
const refactorResult = await runPhase({
  phasePrompt: (i, fb) => `Refactor iteration ${i}: apply the refactor preserving behavior exactly. ${fb ? 'Address prior grader feedback: ' + fb : ''} Run CGC blast-radius before editing each symbol. Do NOT change public behavior/contracts; only structure. Update all call sites found in research. Research: ${JSON.stringify(research.out)}. Discovery: ${JSON.stringify(discovery)}. Refactor target: ${a._ ? a._.join(' ') : ''}`,
  phaseSchema: SCHEMAS.implementation,
  agentType: 'scope-locked-editor',
  label: 'refactor',
  maxIterations: PHASE_BUDGETS.impl,
  model: modelFor('impl', a), gradeModel: modelFor('grade', a),
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
  phasePrompt: (i, fb) => `Test iteration ${i}: verify behavior is UNCHANGED after the refactor. ${fb ? 'Address prior grader feedback: ' + fb : ''} Run the existing test suite; confirm no test changed meaning; targetEnv=${targetEnv}. Refactor: ${JSON.stringify(refactorResult.out)}. Discovery: ${JSON.stringify(discovery)}.`,
  phaseSchema: SCHEMAS.testing,
  agentType: 'test-runner',
  label: 'testing',
  maxIterations: PHASE_BUDGETS.testing,
  model: modelFor('testing', a), gradeModel: modelFor('grade', a),
  gradePrompt: (out) => `Grade this test run: confirm the suite passes and no test changed semantics. Output: ${JSON.stringify(out)}`,
});
if (!testResult.ok) {
  await agent(handoffPrompt('testing did not pass within budget', 'rerun /refactor or investigate test failures manually'), { agentType: 'pr-author', label: 'handoff:testing', model: modelFor('persist', a) });
  return { verdict: 'needs_human', phase: 'testing' };
}
await persistPhase(beadId, 'Test', testResult.out);

return { verdict: 'APPROVE', bead: beadId };
