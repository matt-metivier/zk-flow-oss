// src/fragments/run-phase.js
// Grade-gated bounded phase loop. Runs the phase agent, then a grader agent that emits a
// review.json verdict, so every phase (even ones whose schema has no verdict) actually gates.
//
// Fixes:
// - Explicit rubricPath injected into gradePrompt so grader always knows which rubric to read
// - GraderFeedback persisted to bd after every grader call (enables /improve to work)
//   The bead ID is derived from the label's first segment (e.g. 'research' from 'research:1')

export async function runPhase({ phasePrompt, phaseSchema, agentType, label, maxIterations, gradePrompt, model, gradeModel, posture = '', beadId = null, phaseName = null, canEscalate = false, startTier = null, isolation = null }) {
  // isolation:'worktree' forwards to the PHASE agent() so the runtime sandboxes
  // the writer in its own worktree (the agent-frontmatter `isolation` is ignored
  // by the Workflow runtime — only the agent() opt is honored). Grader/persist
  // agents are read-only and never get it. Each iteration gets a fresh worktree,
  // so workspaceBootstrap continues the run branch (checkout, not -B reset).
  // Worktree enforcement: code-writing agents ALWAYS run in an isolated worktree,
  // even when a caller forgets to pass isolation:'worktree'. The Workflow runtime
  // ignores the agent-frontmatter `isolation`; only the agent() opt actually
  // sandboxes the writer in its own worktree. Forcing it here makes "every writer
  // is isolated" a structural invariant of runPhase, not a per-call habit that can
  // silently regress (zk-flow worktree-always rule).
  const WRITER_AGENT_TYPES = ['scope-locked-editor', 'pr-author'];
  const enforcedIsolation = (!isolation && WRITER_AGENT_TYPES.includes(agentType)) ? 'worktree' : isolation;
  const iso = enforcedIsolation ? { isolation: enforcedIsolation } : {};
  // Fail-fast: canEscalate=true without startTier is a misconfiguration, not a silent no-op.
  if (canEscalate && !startTier) throw new Error('runPhase: canEscalate=true requires startTier to be set');

  const withPosture = (p) => posture ? `${posture}\n\n${p}` : p;
  // Derive phase name from label for rubric injection (e.g. 'research' from 'research:1')
  const phase = phaseName || label.split(':')[0].split('-grade')[0];
  const rubricPath = `prompts/rubrics/${phase}-rubric.md`;
  let out, grade, feedback = '';

  for (let i = 1; i <= maxIterations; i++) {
    out = await agent(withPosture(phasePrompt(i, feedback)), { schema: phaseSchema, agentType, label: `${label}:${i}`, ...(model !== undefined && { model }), ...iso });

    // Inject phase name + rubric path into gradePrompt so grader reads the right rubric
    const gradeContext = `Phase: ${phase}. Rubric: ${rubricPath} — read this file to get scoring criteria.\n\n`;
    // gradeModel is a FIXED invariant: bound from the outer param, never re-derived in the escalation loop.
    grade = await agent(gradeContext + gradePrompt(out, i), { schema: SCHEMAS.review, agentType: 'grader', label: `${label}-grade:${i}`, ...(gradeModel !== undefined && { model: gradeModel }) });

    // Persist GraderFeedback to bd so /improve can cluster patterns over time
    if (beadId && grade) {
      await agent(
        `Persist GraderFeedback. Run EXACTLY this shell, then report done:\n\`\`\`\n${bdWrite(beadId, 'GraderFeedback', { phase, iteration: i, verdict: grade.verdict, weighted_score: grade.weighted_score, findings: (grade.findings || []).slice(0, 5) })}\n\`\`\``,
        { label: `persist:graderfeedback:${phase}:${i}`, agentType: 'persist', model: MODEL_TIERS.fast }
      );
    }

    // Auto-guardrails: every phase, every iteration
    assertPhaseOutput(out, phase);
    assertFindings(grade, phase);
    if (grade && grade.verdict === 'APPROVE') return { out, grade, ok: true, iterations: i, escalated: false };
    feedback = JSON.stringify((grade && grade.findings) || grade || {});
  }

  // Escalation ladder: after maxIterations without APPROVE, try each higher tier once.
  // canEscalate is set by the caller — user model pins set canEscalate=false (hard cap).
  // gradeModel is NOT escalated: grader tier is a fixed invariant across all escalation steps.
  if (canEscalate) {
    const fromTier = startTier;
    let curTier = startTier;
    let nextT;
    while ((nextT = nextTier(curTier)) !== null) {
      curTier = nextT;
      const curModel = MODEL_TIERS[curTier];
      out = await agent(withPosture(phasePrompt(maxIterations + 1, feedback)), { schema: phaseSchema, agentType, label: `${label}:escalate:${curTier}`, model: curModel, ...iso });

      const gradeContext = `Phase: ${phase}. Rubric: ${rubricPath} — read this file to get scoring criteria.\n\n`;
      grade = await agent(gradeContext + gradePrompt(out, maxIterations + 1), { schema: SCHEMAS.review, agentType: 'grader', label: `${label}-grade:escalate:${curTier}`, ...(gradeModel !== undefined && { model: gradeModel }) });

      if (beadId && grade) {
        await agent(
          `Persist GraderFeedback. Run EXACTLY this shell, then report done:\n\`\`\`\n${bdWrite(beadId, 'GraderFeedback', { phase, iteration: 'escalate', verdict: grade.verdict, weighted_score: grade.weighted_score, findings: (grade.findings || []).slice(0, 5), escalated: true, fromTier, toTier: curTier })}\n\`\`\``,
          { label: `persist:graderfeedback:${phase}:escalate:${curTier}`, agentType: 'persist', model: MODEL_TIERS.fast }
        );
      }

      assertPhaseOutput(out, phase);
      assertFindings(grade, phase);
      if (grade && grade.verdict === 'APPROVE') return { out, grade, ok: true, iterations: maxIterations, escalated: true, fromTier, toTier: curTier };
      feedback = JSON.stringify((grade && grade.findings) || grade || {});
    }
  }

  // backtrackEligible: phase exhausted iterations + escalation without APPROVE.
  // Additive field — existing callers ignore it. The backtrack.js helper reads
  // this flag as the trigger to re-run the prior phase once before needs_human.
  return { out, grade, ok: false, iterations: maxIterations, escalated: false, backtrackEligible: true };
}
