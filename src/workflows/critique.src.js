// src/workflows/critique.src.js
// @@USE: depth-map,verdict,budgets,schemas,args,model-tiers
export const meta = { name: 'critique', description: 'Design with adversarial pass + review council', phases: [{title:'Draft'},{title:'Adversarial'},{title:'Council'}] };
// @@FRAGMENTS@@

const a = readArgs(args);                        // Task 0: args arrive as text

// Adapted from uditakhourii/adhd (MIT): optional wide ideation pre-pass to reduce anchoring bias.
const IDEATION_FRAMES = ['minimal','radical','invert-the-constraint','borrow-from-another-domain','first-principles'];
let ideationNote = '';
if (a.ideate === 'true' || a.ideate === true) {
  const nFrames = Number(a.frames) || 5;
  const topK = Number(a.topK) || 3;
  const ideaAgents = Array.from({ length: nFrames }, (_, i) => {
    const frame = IDEATION_FRAMES[i % IDEATION_FRAMES.length];
    return () => agent(
      `You are a divergent idea generator. Frame: "${frame}". Problem: ${a.brief || '(no brief)'}. Generate ONE distinct design direction using this frame. DIVERGE only — no evaluation, no anchoring on prior ideas. Output a short idea sketch (2-5 sentences).`,
      { label:`ideation:${frame}`, phase:'Draft', agentType:'designer', model: modelFor('design', a) }
    );
  });
  const ideas = await parallel(ideaAgents);
  const ideasText = ideas.map(function(x, i) { return '[' + (i + 1) + '] ' + JSON.stringify(x); }).join('\n');
  const shortlist = await agent(
    'You are an arbiter. Score these ' + nFrames + ' design ideas on novelty, viability, and fit. Flag traps. Cluster by angle. Select the top ' + topK + ' and emit a concise shortlist (one bullet per idea).\nIdeas:\n' + ideasText,
    { label:'ideation:critic', phase:'Draft', agentType:'grader', model: modelFor('grade', a) }
  )
  ideationNote = 'Consider these vetted directions:\n' + JSON.stringify(shortlist) + '\n';
}

phase('Draft');
let design = await agent(`Draft the SQCA design. ${ideationNote}${a.brief || ''}`, { label:'designer', phase:'Draft', agentType:'designer', schema: SCHEMAS.design, model: modelFor('design', a) });

phase('Adversarial');
const [devil, grillOut] = await parallel([
  () => agent(`Devil's advocate: fastest single-perspective stress test of this design: ${JSON.stringify(design)}`, { label:'devils-advocate', phase:'Adversarial', agentType:'devils-advocate', model: modelFor('grill', a) }),
  () => agent(`Grill this design (one-shot): ${JSON.stringify(design)}. Output challenges[].`, { label:'griller', phase:'Adversarial', agentType:'griller', model: modelFor('grill', a) }),
]);
design = await agent(`Update the design addressing these objections.\nDevil: ${JSON.stringify(devil)}\nGrill: ${JSON.stringify(grillOut)}\nDesign: ${JSON.stringify(design)}`, { label:'designer-response', phase:'Adversarial', agentType:'designer', schema: SCHEMAS.design, model: modelFor('design', a) });

phase('Council');
let grade, gradeOk = false;
for (let di = 1; di <= PHASE_BUDGETS.design; di++) {
  // Re-generate perspective fan-out inside the loop so each revision is re-reviewed
  const persp = await parallel(validPerspectives(DEFAULT_PERSPECTIVES).map(p => () =>
    agent(`Review the design from the "${p}" perspective: ${JSON.stringify(design)}`, { label:`design:${p}:${di}`, phase:'Council', agentType:p, model: modelFor('review', a) })));
  grade = await agent(
    `Grader: synthesize design verdict from perspectives (iteration ${di}): ${JSON.stringify(persp.filter(Boolean))}`,
    { label:`grader:design:${di}`, phase:'Council', agentType:'grader', schema: SCHEMAS.review, model: modelFor('grade', a) });
  if (grade && grade.verdict === 'APPROVE') { gradeOk = true; break; }
  if (di < PHASE_BUDGETS.design) {
    design = await agent(
      `Revise the design to address reviewer objections. Feedback: ${JSON.stringify(grade)}. Current design: ${JSON.stringify(design)}`,
      { label:`designer:revision:${di}`, phase:'Council', agentType:'designer', schema: SCHEMAS.design, model: modelFor('design', a) });
  }
}

return { design, verdict: grade ? grade.verdict : 'BLOCK', route: routeVerdict(grade ? grade.verdict : 'BLOCK'), gradeOk };
