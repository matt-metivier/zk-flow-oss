// src/workflows/review.src.js
// @@USE: depth-map,verdict,schemas,args,model-tiers,bd-memory,bead-run
export const meta = {
  name: 'review',
  description: 'Multi-perspective code review with depth modes (none/light/standard/full)',
  phases: [{ title: 'Perspectives' }, { title: 'Synthesis' }],
};
// @@FRAGMENTS@@

const a = readArgs(args);                       // Task 0: args arrive as text
const depth = a.depth || 'standard';
const perspectives = validPerspectives(a.perspectives ? a.perspectives.split(',') : DEFAULT_PERSPECTIVES);
const criteria = criteriaForDepth(depth);

phase('Perspectives');
const findings = await parallel(perspectives.map(p => () =>
  agent(`${postureFor('review', a)}\n\nReview the current diff from the "${p}" perspective. Evaluate ONLY these criteria ` +
        `(and shallower): ${criteria.join(', ')}. Return findings with severity P0-P3, file, line, why_it_matters.`,
        { label: `review:${p}`, phase: 'Perspectives', agentType: p, model: modelFor('review', a) })
));

phase('Synthesis');
const synthesis = await agent(
  `${postureFor('grade', a)}\n\nYou are the arbiter. Merge duplicate findings (same line -> highest severity). ` +
  `Synthesize these perspective outputs into a single verdict using the review rubric (depth=${depth}). ` +
  `Findings:\n${JSON.stringify(findings.filter(Boolean))}`,
  { label: 'arbiter', phase: 'Synthesis', agentType: 'arbiter', schema: SCHEMAS.review, model: modelFor('grade', a) });

const sv = (synthesis && synthesis.verdict) || 'BLOCK';
// Persist GraderFeedback for /improve signal
const reviewBeadId = runBeadId(a);
if (reviewBeadId) {
  await agent(`Persist GraderFeedback. Run EXACTLY this shell, then report done:\n\`\`\`\n${bdWrite(reviewBeadId, 'GraderFeedback', { phase: 'review', verdict: synthesis && synthesis.verdict, findings: (synthesis && synthesis.findings || []).slice(0, 5), depth })}\n\`\`\``, { label: 'persist:graderfeedback:review', agentType: 'researcher', model: MODEL_TIERS.fast });
}
return { verdict: sv, route: routeVerdict(sv), depth, perspectives, findings: synthesis };
