// src/workflows/design.src.js
// @@USE: run-phase,handoff,depth-map,verdict,budgets,schemas,args,bd-memory,bead-run,model-tiers,env-check,guardrails,skill-render,persona-load,prompt-loader
export const meta = {
  name: 'design',
  description: 'Discover + research + design panel with handoff boundary to feature impl',
  phases: [{title:'Research'},{title:'Discover'},{title:'Design'},{title:'Handoff'}],
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
  phasePrompt: (i, fb) => loadPhasePrompt('research', { iteration: i, feedback: fb || null, request: (a._ ? a._.join(' ') : '') }),
  phaseSchema: SCHEMAS.research,
  agentType: 'researcher',
  label: 'research',
  maxIterations: PHASE_BUDGETS.research,
  model: modelFor('research', a), gradeModel: modelFor('grade', a),
  posture: postureFor('research', a),
  gradePrompt: (out) => `Grade this research output for completeness, evidence quality, and relevance to the design task. Output: ${JSON.stringify(out)}`,
});
if (!research.ok) {
  await agent(handoffPrompt('research did not pass within budget', 'rerun /design or refine the request'), { label: 'handoff:research', model: modelFor('persist', a) });
  return { verdict: 'needs_human', phase: 'research' };
}
await persistPhase(beadId, 'Research', research.out);
assertEvidencePresent(research.out, 'Research');
  const skillsBlock = await renderSkills(discovery.selected_skills, modelFor('research', a));

// --- DESIGN PANEL (with perspectives inside the loop) ---
phase('Design');
// designer draft
let design = await agent(
  `${postureFor('design', a)}\n\nDraft the design for this feature. Use SQCA format (Summary, Questions, Context, Approach). Research: ${JSON.stringify(research.out)}. Request: ${a._ ? a._.join(' ') : ''}`,
  { schema: SCHEMAS.design, agentType: 'designer', label: 'designer:1', model: modelFor('design', a) }
);

// adversarial pass (parallel, one-shot)
const [devil, grillOut] = await parallel([
  () => agent(
    `${postureFor('grill', a)}\n\nDevil's advocate: fastest single-perspective stress test of this design: ${JSON.stringify(design)}`,
    { label: 'devils-advocate', agentType: 'devils-advocate', model: modelFor('grill', a) }
  ),
  () => agent(
    `${postureFor('grill', a)}\n\nGrill this design (one-shot): ${JSON.stringify(design)}. Output challenges[].`,
    { label: 'griller', agentType: 'griller', model: modelFor('grill', a) }
  ),
]);

// designer response to objections
design = await agent(
  `${postureFor('design', a)}\n\nUpdate the design addressing these objections.\nDevil: ${JSON.stringify(devil)}\nGrill: ${JSON.stringify(grillOut)}\nDesign: ${JSON.stringify(design)}`,
  { schema: SCHEMAS.design, agentType: 'designer', label: 'designer:response', model: modelFor('design', a) }
);

// perspective council: loop with perspectives INSIDE so each revision is re-reviewed
let grade, designApproved = false;
for (let di = 1; di <= PHASE_BUDGETS.design; di++) {
  const persp = await parallel(validPerspectives(DEFAULT_PERSPECTIVES).map(p => () =>
    agent(
      `${postureFor('review', a)}\n\nReview the design from the "${p}" perspective: ${JSON.stringify(design)}`,
      { label: `design-council:${p}:${di}`, agentType: p, model: modelFor('review', a) }
    )
  ));
  grade = await agent(
    `${postureFor('grade', a)}\n\nGrader: synthesize design verdict from perspective reviews (iteration ${di}): ${JSON.stringify(persp.filter(Boolean))}`,
    { schema: SCHEMAS.review, agentType: 'grader', label: `grader:design:${di}`, model: modelFor('grade', a) }
  );
  if (grade && grade.verdict === 'APPROVE') { designApproved = true; break; }
  if (di < PHASE_BUDGETS.design) {
    design = await agent(
      `${postureFor('design', a)}\n\nRevise the design to address reviewer objections. Feedback: ${JSON.stringify(grade)}. Current design: ${JSON.stringify(design)}`,
      { schema: SCHEMAS.design, agentType: 'designer', label: `designer:revision:${di}`, model: modelFor('design', a) }
    );
  }
}

await persistPhase(beadId, 'DesignGrade', grade);

// --- DISCOVER ---
phase('Discover');
const discovery = await agent(
  `${postureFor('discover', a)}\n\n${buildPersonaSection()}\n\nSelect skills, vault paths, and related beads using research findings and persona context.\nResearch summary: ${JSON.stringify({key_findings: research.out.key_findings, synthesis: research.out.synthesis})}\nRequest: ${a._ ? a._.join(' ') : '(infer from context)'}`,
  { schema: SCHEMAS.discover, agentType: 'researcher', label: 'discover:1', model: modelFor('discover', a) }
);
await persistPhase(beadId, 'Discover', discovery);
assertDiscoverValid(discovery, 'Discover');

// --- HANDOFF ---
phase('Handoff');
const handoffMsg = `Design complete and ready for implementation. Pass bead=${beadId} to the next run so it can load prior context.\nSuggested next workflow: /feature startAt=impl bead=${beadId}\nHuman must review and approve the design before resuming.\nDesign verdict: ${JSON.stringify(grade)}.\nDesign: ${JSON.stringify(design)}.\nRedact any secrets or credentials.`;
const handoff = await agent(handoffPrompt(handoffMsg, `/feature startAt=impl bead=${beadId}`), { agentType: 'pr-author', label: 'handoff:design-complete', model: modelFor('persist', a) });

return { design, verdict: grade ? grade.verdict : 'BLOCK', route: routeVerdict(grade ? grade.verdict : 'BLOCK'), handoff };
