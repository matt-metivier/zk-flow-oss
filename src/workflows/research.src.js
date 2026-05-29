// src/workflows/research.src.js
// @@USE: run-phase,handoff,budgets,schemas,args,bd-memory,bead-run,model-tiers
export const meta = {
  name: 'research',
  description: 'Investigate and STOP: discover -> research. No design or implementation. Use when you need a research synthesis before committing to a solution.',
  phases: [{title:'Discover'},{title:'Research'}],
};
// @@FRAGMENTS@@

const a = readArgs(args);
const beadId = runBeadId(a);

// --- DISCOVER ---
phase('Discover');
const discovery = await agent(
  `Discover the codebase scope for this investigation. Emit skills to load, vault paths relevant to this domain, related bead IDs from prior similar research, and rationale. Topic: ${a._ ? a._.join(' ') : '(infer from context)'}`,
  { schema: SCHEMAS.discover, agentType: 'researcher', label: 'discover:1', model: modelFor('discover', a) }
);
await persistPhase(beadId, 'Discover', discovery);

// --- RESEARCH ---
phase('Research');
const research = await runPhase({
  phasePrompt: (i, fb) => `Research iteration ${i}: investigate the topic thoroughly. Identify key findings, evidence, unknowns, and recommended next steps. ${fb ? 'Address prior grader feedback: ' + fb : ''} Discovery: ${JSON.stringify(discovery)}. Topic: ${a._ ? a._.join(' ') : ''}`,
  phaseSchema: SCHEMAS.research,
  agentType: 'researcher',
  label: 'research',
  maxIterations: PHASE_BUDGETS.research,
  model: modelFor('research', a), gradeModel: modelFor('grade', a),
  gradePrompt: (out) => `Grade this research against the research rubric: ${JSON.stringify(out)}`,
});
if (!research.ok) {
  await agent(handoffPrompt('research did not pass within budget', 'rerun /research or refine the topic'), { agentType: 'pr-author', label: 'handoff:research', model: modelFor('persist', a) });
  return { verdict: 'needs_human', phase: 'research' };
}

// Persist synthesis to beads
await persistPhase(beadId, 'ResearchSynthesis', research.out);

// Final handoff doc
await agent(handoffPrompt('research complete: ' + JSON.stringify(research.out), 'run /design (pass bead=' + beadId + ') or /feature startAt=discover'), { agentType: 'pr-author', label: 'handoff:research-complete', model: modelFor('persist', a) });

return { verdict: 'research_complete', synthesis: research.out, bead: beadId };
