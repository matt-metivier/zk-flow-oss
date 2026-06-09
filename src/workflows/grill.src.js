// src/workflows/grill.src.js
// @@USE: args,model-tiers,bd-memory,bead-run
export const meta = { name: 'grill', description: 'Adversarial grilling: griller -> decider, interview or one-shot', phases: [{ title: 'Grill' }] };
// @@FRAGMENTS@@

const a = readArgs(args);                        // Task 0: args arrive as text
const mode = a.mode || 'one-shot';               // 'one-shot' | 'interview'
const _n = Number(a.maxIterations);
const maxIterations = Number.isInteger(_n) && _n > 0 ? Math.min(_n, 5) : (mode === 'interview' ? 2 : 1);

phase('Grill');
let transcript = [];
for (let i = 1; i <= maxIterations; i++) {
  const round = await agent(
    `${postureFor('grill', a)}\n\nGrill the design/impl (round ${i}/${maxIterations}). For each claim ask 3 rounds of ` +
    `"why"/"how do you know"; hunt failure modes, unstated assumptions. Prior: ${JSON.stringify(transcript)}`,
    { label: `griller:${i}`, phase: 'Grill', agentType: 'griller', model: modelFor('grill', a) });
  transcript.push(round);
}
const decision = await agent(
  `${postureFor('grade', a)}\n\nAs decider, synthesize the griller transcript into structured challenges[] ` +
  `(target, question, why_it_matters, evidence_required, resolution). Transcript: ${JSON.stringify(transcript)}`,
  { label: 'decider', phase: 'Grill', agentType: 'decider', model: modelFor('grade', a) });
const _grillBeadId = runBeadId(a);
if (_grillBeadId) {
  await agent(`Persist GraderFeedback. Run EXACTLY this shell:\n\`\`\`\n${bdWrite(_grillBeadId, 'GraderFeedback', { phase: 'grill', verdict: decision && decision.verdict, findings: (decision && (decision.findings || decision.challenges || []) || []).slice(0, 5) })}\n\`\`\``, { label: 'persist:graderfeedback:grill', agentType: 'researcher', model: MODEL_TIERS.fast });
}
return { mode, maxIterations, decision };
