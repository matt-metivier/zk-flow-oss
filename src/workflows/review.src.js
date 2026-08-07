// src/workflows/review.src.js
// @@USE: depth-map,verdict,schemas,args,model-tiers,bd-memory,bead-run,operating-posture,skill-render,env-check,context-pack
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

// Perspective agents review a diff they have no domain context for. Select skills
// from the request/branch text so repo conventions and language rules reach them.
const skillsBlock = await selectAndRenderSkills(
  (a.brief || (a._ ? a._.join(' ') : '')) + ' code review of the current diff',
  null,
  modelFor('discover', a)
);

// Durable context: machine persona + prior beads + vault MOC (no discover phase here).
const ctxBlock = await contextPack((a.brief || (a._ ? a._.join(' ') : '')) + ' code review', (a.brief || 'review'), modelFor('discover', a));

// bd preflight: this workflow persists GraderFeedback, and bdWrite against an
// uninitialized bd fails silently — /improve then sees no signal and cannot know why.
// Non-fatal by design: the verdict is still useful without persistence, so warn and
// skip the write rather than aborting a review that already ran.
const _bdOk = await agent(BD_PREFLIGHT_PROMPT, { label: 'preflight:bd', agentType: 'researcher', model: MODEL_TIERS.fast });
const _bdUsable = !!(_bdOk && _bdOk.ok !== false);

phase('Perspectives');
const findings = await parallel(perspectives.map(p => () =>
  agent(`${postureFor('review', a)}\n\nReview the current diff from the "${p}" perspective. Evaluate ONLY these criteria ` +
        `(and shallower): ${criteria.join(', ')}. Return findings with severity P0-P3, file, line, why_it_matters.${skillsBlock}${ctxBlock}`,
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
if (reviewBeadId && _bdUsable) {
  await agent(`Persist GraderFeedback. Run EXACTLY this shell, then report done:\n\`\`\`\n${bdWrite(reviewBeadId, 'GraderFeedback', { phase: 'review', verdict: synthesis && synthesis.verdict, findings: (synthesis && synthesis.findings || []).slice(0, 5), depth })}\n\`\`\``, { label: 'persist:graderfeedback:review', agentType: 'researcher', model: MODEL_TIERS.fast });
}
return { verdict: sv, route: routeVerdict(sv), depth, perspectives, findings: synthesis };
