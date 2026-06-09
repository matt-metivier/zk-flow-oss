// src/fragments/run-phase.js
// Grade-gated bounded phase loop. Runs the phase agent, then a grader agent that emits a
// review.json verdict, so every phase (even ones whose schema has no verdict) actually gates.
export async function runPhase({ phasePrompt, phaseSchema, agentType, label, maxIterations, gradePrompt, model, gradeModel, posture = '' }) {
  const withPosture = (p) => posture ? `${posture}\n\n${p}` : p;
  let out, grade, feedback = '';
  for (let i = 1; i <= maxIterations; i++) {
    out = await agent(withPosture(phasePrompt(i, feedback)), { schema: phaseSchema, agentType, label: `${label}:${i}`, ...(model !== undefined && { model }) });
    grade = await agent(gradePrompt(out, i), { schema: SCHEMAS.review, agentType: 'grader', label: `${label}-grade:${i}`, ...(gradeModel !== undefined && { model: gradeModel }) });
    if (grade && grade.verdict === 'APPROVE') return { out, grade, ok: true, iterations: i };
    feedback = JSON.stringify((grade && grade.findings) || grade || {});
  }
  return { out, grade, ok: false, iterations: maxIterations };
}
