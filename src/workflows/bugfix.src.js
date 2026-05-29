// src/workflows/bugfix.src.js
// @@USE: run-phase,handoff,verdict,budgets,schemas,args,bd-memory,bead-run,ci-loop,model-tiers
export const meta = {
  name: 'bugfix',
  description: 'Bug fix lifecycle: discover->research->impl->ci->testing. Mirrors feature minus design and review phases.',
  phases: [{title:'Discover'},{title:'Research'},{title:'Impl'},{title:'CI'},{title:'Testing'}],
};
// @@FRAGMENTS@@

const a = readArgs(args);
const beadId = runBeadId(a);

// --- DISCOVER ---
phase('Discover');
const discovery = await agent(
  `Discover the codebase scope for this bug. Emit skills to load, vault paths relevant to this bug domain, related bead IDs from prior similar fixes, and rationale. Bug report: ${a._ ? a._.join(' ') : '(infer from context)'}`,
  { schema: SCHEMAS.discover, agentType: 'researcher', label: 'discover:1', model: modelFor('discover', a) }
);
await persistPhase(beadId, 'Discover', discovery);

// --- RESEARCH ---
phase('Research');
const research = await runPhase({
  phasePrompt: (i, fb) => `Research iteration ${i}: understand the root cause, reproduction steps, and fix approaches. ${fb ? 'Address prior grader feedback: ' + fb : ''} Discovery: ${JSON.stringify(discovery)}. Bug: ${a._ ? a._.join(' ') : ''}`,
  phaseSchema: SCHEMAS.research,
  agentType: 'researcher',
  label: 'research',
  maxIterations: PHASE_BUDGETS.research,
  model: modelFor('research', a), gradeModel: modelFor('grade', a),
  gradePrompt: (out) => `Grade this research output for completeness, evidence quality, and root cause clarity. Output: ${JSON.stringify(out)}`,
});
if (!research.ok) {
  await agent(handoffPrompt('research did not pass within budget', 'rerun /bugfix or refine the bug report'), { agentType: 'pr-author', label: 'handoff:research', model: modelFor('persist', a) });
  return { verdict: 'needs_human', phase: 'research' };
}
await persistPhase(beadId, 'Research', research.out);

// --- IMPL ---
phase('Impl');
let implResult = await runPhase({
  phasePrompt: (i, fb) => `Implementation iteration ${i}: write the fix. ${fb ? 'Address prior grader feedback: ' + fb : ''} Research: ${JSON.stringify(research.out)}. Discovery: ${JSON.stringify(discovery)}. Bug: ${a._ ? a._.join(' ') : ''}`,
  phaseSchema: SCHEMAS.implementation,
  agentType: 'scope-locked-editor',
  label: 'impl',
  maxIterations: PHASE_BUDGETS.impl,
  model: modelFor('impl', a), gradeModel: modelFor('grade', a),
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
  gradePrompt: (out) => `Grade this testing output for coverage, regression safety, and evidence that the bug is fixed. Output: ${JSON.stringify(out)}`,
});
if (!testing.ok) {
  await agent(handoffPrompt('testing did not pass within budget', 'investigate test failures manually'), { agentType: 'pr-author', label: 'handoff:testing', model: modelFor('persist', a) });
  return { verdict: 'needs_human', phase: 'testing' };
}
await persistPhase(beadId, 'Testing', testing.out);
await agent(`Persist GraderFeedback for improve. Run EXACTLY this shell, then report done:\n\`\`\`\n${bdWrite('improve', 'GraderFeedback', { phase: 'testing', verdict: 'APPROVE', findings: testing.out })}\n\`\`\``, { label: 'persist:graderfeedback:testing', agentType: 'researcher', model: modelFor('persist', a) });

return { verdict: 'APPROVE', route: 'done', impl: implResult.out, testing: testing.out };
