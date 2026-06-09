// src/fragments/run-phase.js
// Grade-gated bounded phase loop. Runs the phase agent, then a grader agent that emits a
// review.json verdict, so every phase (even ones whose schema has no verdict) actually gates.
//
// Fixes:
// - Explicit rubricPath injected into gradePrompt so grader always knows which rubric to read
// - GraderFeedback persisted to bd after every grader call (enables /improve to work)
//   The bead ID is derived from the label's first segment (e.g. 'research' from 'research:1')

export async function runPhase({ phasePrompt, phaseSchema, agentType, label, maxIterations, gradePrompt, model, gradeModel, posture = '', beadId = null, phaseName = null }) {
  const withPosture = (p) => posture ? `${posture}\n\n${p}` : p;
  // Derive phase name from label for rubric injection (e.g. 'research' from 'research:1')
  const phase = phaseName || label.split(':')[0].split('-grade')[0];
  const rubricPath = `prompts/rubrics/${phase}-rubric.md`;
  let out, grade, feedback = '';

  for (let i = 1; i <= maxIterations; i++) {
    out = await agent(withPosture(phasePrompt(i, feedback)), { schema: phaseSchema, agentType, label: `${label}:${i}`, ...(model !== undefined && { model }) });

    // Inject phase name + rubric path into gradePrompt so grader reads the right rubric
    const gradeContext = `Phase: ${phase}. Rubric: ${rubricPath} — read this file to get scoring criteria.\n\n`;
    grade = await agent(gradeContext + gradePrompt(out, i), { schema: SCHEMAS.review, agentType: 'grader', label: `${label}-grade:${i}`, ...(gradeModel !== undefined && { model: gradeModel }) });

    // Persist GraderFeedback to bd so /improve can cluster patterns over time
    if (beadId && grade) {
      await agent(
        `Persist GraderFeedback. Run EXACTLY this shell, then report done:\n\`\`\`\n${bdWrite(beadId, 'GraderFeedback', { phase, iteration: i, verdict: grade.verdict, weighted_score: grade.weighted_score, findings: (grade.findings || []).slice(0, 5) })}\n\`\`\``,
        { label: `persist:graderfeedback:${phase}:${i}`, agentType: 'researcher', model: MODEL_TIERS.fast }
      );
    }

    assertFindings(grade, phase);
    if (grade && grade.verdict === 'APPROVE') return { out, grade, ok: true, iterations: i };
    feedback = JSON.stringify((grade && grade.findings) || grade || {});
  }
  return { out, grade, ok: false, iterations: maxIterations };
}
