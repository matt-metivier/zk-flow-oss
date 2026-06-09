// src/workflows/research.src.js
// @@USE: run-phase,handoff,budgets,schemas,args,bd-memory,bead-run,model-tiers,env-check,guardrails,skill-render,persona-load
export const meta = {
  name: 'research',
  description: 'Investigate and STOP: discover -> research. No design or implementation. Use when you need a research synthesis before committing to a solution.',
  phases: [{title:'Research'},{title:'Discover'}],
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
  phasePrompt: (i, fb) => `Research iteration ${i}: investigate the topic thoroughly. Identify key findings, evidence, unknowns, and recommended next steps. ${fb ? 'Address prior grader feedback: ' + fb : ''} Topic: ${a._ ? a._.join(' ') : ''}`,
  phaseSchema: SCHEMAS.research,
  agentType: 'researcher',
  label: 'research',
  maxIterations: PHASE_BUDGETS.research,
  model: modelFor('research', a), gradeModel: modelFor('grade', a),
  posture: postureFor('research', a),
  gradePrompt: (out) => `Grade this research against the research rubric: ${JSON.stringify(out)}`,
});
if (!research.ok) {
  await agent(handoffPrompt('research did not pass within budget', 'rerun /research or refine the topic'), { agentType: 'pr-author', label: 'handoff:research', model: modelFor('persist', a) });
  return { verdict: 'needs_human', phase: 'research' };
}

// Persist synthesis to beads
await persistPhase(beadId, 'ResearchSynthesis', research.out);
assertEvidencePresent(research.out, 'Research');
  const skillsBlock = await renderSkills(discovery.selected_skills, modelFor('research', a));

// Final handoff doc
await agent(handoffPrompt('research complete: ' + JSON.stringify(research.out), 'run /design (pass bead=' + beadId + ') or /feature startAt=discover'), { agentType: 'pr-author', label: 'handoff:research-complete', model: modelFor('persist', a) });

return { verdict: 'research_complete', synthesis: research.out, bead: beadId };
// --- DISCOVER ---
phase('Discover');
const discovery = await agent(
  `${postureFor('discover', a)}\n\n${buildPersonaSection()}\n\nSelect skills, vault paths, and related beads using research findings and persona context.\nResearch summary: ${JSON.stringify({key_findings: research.out.key_findings, synthesis: research.out.synthesis})}\nRequest(infer from context)'}`,
  { schema: SCHEMAS.discover, agentType: 'researcher', label: 'discover:1', model: modelFor('discover', a) }
);
await persistPhase(beadId, 'Discover', discovery);

