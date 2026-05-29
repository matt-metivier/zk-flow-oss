// src/workflows/design.src.js
// @@USE: run-phase,handoff,depth-map,verdict,budgets,schemas,args,bd-memory,bead-run,model-tiers
export const meta = {
  name: 'design',
  description: 'Discover + research + design panel with handoff boundary to feature impl',
  phases: [{title:'Discover'},{title:'Research'},{title:'Design'},{title:'Handoff'}],
};
// @@FRAGMENTS@@

const a = readArgs(args);
const beadId = runBeadId(a);

// --- DISCOVER ---
phase('Discover');
const discovery = await agent(
  `Discover the codebase scope for this feature request. Emit skills to load, vault paths relevant to this feature domain, related bead IDs from prior similar work, and rationale. Request: ${a._ ? a._.join(' ') : '(no request text -- infer from context)'}`,
  { schema: SCHEMAS.discover, agentType: 'researcher', label: 'discover:1', model: modelFor('discover', a) }
);
await persistPhase(beadId, 'Discover', discovery);

// --- RESEARCH ---
phase('Research');
const research = await runPhase({
  phasePrompt: (i, fb) => `Research iteration ${i}: gather context, prior art, and constraints for the requested design. ${fb ? 'Address prior grader feedback: ' + fb : ''} Discovery: ${JSON.stringify(discovery)}. Request: ${a._ ? a._.join(' ') : ''}`,
  phaseSchema: SCHEMAS.research,
  agentType: 'researcher',
  label: 'research',
  maxIterations: PHASE_BUDGETS.research,
  model: modelFor('research', a), gradeModel: modelFor('grade', a),
  gradePrompt: (out) => `Grade this research output for completeness, evidence quality, and relevance to the design task. Output: ${JSON.stringify(out)}`,
});
if (!research.ok) {
  await agent(handoffPrompt('research did not pass within budget', 'rerun /design or refine the request'), { label: 'handoff:research', model: modelFor('persist', a) });
  return { verdict: 'needs_human', phase: 'research' };
}
await persistPhase(beadId, 'Research', research.out);

// --- DESIGN PANEL (with perspectives inside the loop) ---
phase('Design');
// designer draft
let design = await agent(
  `Draft the design for this feature. Use SQCA format (Summary, Questions, Context, Approach). Research: ${JSON.stringify(research.out)}. Discovery: ${JSON.stringify(discovery)}. Request: ${a._ ? a._.join(' ') : ''}`,
  { schema: SCHEMAS.design, agentType: 'designer', label: 'designer:1', model: modelFor('design', a) }
);

// adversarial pass (parallel, one-shot)
const [devil, grillOut] = await parallel([
  () => agent(
    `Devil's advocate: fastest single-perspective stress test of this design: ${JSON.stringify(design)}`,
    { label: 'devils-advocate', agentType: 'devils-advocate', model: modelFor('grill', a) }
  ),
  () => agent(
    `Grill this design (one-shot): ${JSON.stringify(design)}. Output challenges[].`,
    { label: 'griller', agentType: 'griller', model: modelFor('grill', a) }
  ),
]);

// designer response to objections
design = await agent(
  `Update the design addressing these objections.\nDevil: ${JSON.stringify(devil)}\nGrill: ${JSON.stringify(grillOut)}\nDesign: ${JSON.stringify(design)}`,
  { schema: SCHEMAS.design, agentType: 'designer', label: 'designer:response', model: modelFor('design', a) }
);

// perspective council: loop with perspectives INSIDE so each revision is re-reviewed
let grade, designApproved = false;
for (let di = 1; di <= PHASE_BUDGETS.design; di++) {
  const persp = await parallel(validPerspectives(DEFAULT_PERSPECTIVES).map(p => () =>
    agent(
      `Review the design from the "${p}" perspective: ${JSON.stringify(design)}`,
      { label: `design-council:${p}:${di}`, agentType: p, model: modelFor('review', a) }
    )
  ));
  grade = await agent(
    `Grader: synthesize design verdict from perspective reviews (iteration ${di}): ${JSON.stringify(persp.filter(Boolean))}`,
    { schema: SCHEMAS.review, agentType: 'grader', label: `grader:design:${di}`, model: modelFor('grade', a) }
  );
  if (grade && grade.verdict === 'APPROVE') { designApproved = true; break; }
  if (di < PHASE_BUDGETS.design) {
    design = await agent(
      `Revise the design to address reviewer objections. Feedback: ${JSON.stringify(grade)}. Current design: ${JSON.stringify(design)}`,
      { schema: SCHEMAS.design, agentType: 'designer', label: `designer:revision:${di}`, model: modelFor('design', a) }
    );
  }
}

await persistPhase(beadId, 'DesignGrade', grade);

// --- HANDOFF ---
phase('Handoff');
const handoffMsg = `Design complete and ready for implementation. Pass bead=${beadId} to the next run so it can load prior context.\nSuggested next workflow: /feature startAt=impl bead=${beadId}\nHuman must review and approve the design before resuming.\nDesign verdict: ${JSON.stringify(grade)}.\nDesign: ${JSON.stringify(design)}.\nRedact any secrets or credentials.`;
const handoff = await agent(handoffPrompt(handoffMsg, `/feature startAt=impl bead=${beadId}`), { agentType: 'pr-author', label: 'handoff:design-complete', model: modelFor('persist', a) });

return { design, verdict: grade ? grade.verdict : 'BLOCK', route: routeVerdict(grade ? grade.verdict : 'BLOCK'), handoff };
