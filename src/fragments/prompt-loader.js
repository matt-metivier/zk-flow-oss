// src/fragments/prompt-loader.js
// Phase prompt accessors. PHASE_PROMPTS is inlined at build time from prompts/phases/*.md.
// Build fails if any phase prompt file is missing (fail-fast at build time).
//
// Usage in workflow:
//   phasePrompt: (i, fb) => loadPhasePrompt('research', { iteration: i, feedback: fb, request: a._.join(' ') })
//
// The phase file provides the STABLE instructional content (roles, protocols, anti-patterns).
// The dynamic context (iteration, feedback, prior phase output) is appended by the workflow.

export function loadPhasePrompt(phase, ctx) {
  const base = PHASE_PROMPTS[phase];
  if (!base) throw new Error(
    `[prompt-loader] Phase '${phase}' not found in PHASE_PROMPTS. ` +
    `Valid: ${Object.keys(PHASE_PROMPTS).join(', ')}. ` +
    `Check prompts/phases/${phase}.md exists and build was re-run.`
  );
  const parts = [base];
  if (ctx) {
    if (ctx.iteration) parts.push(`\n## This iteration\nIteration: ${ctx.iteration}`);
    if (ctx.feedback) parts.push(`\n## Prior grader feedback (address every point)\n${ctx.feedback}`);
    if (ctx.request) parts.push(`\n## Task request\n${ctx.request}`);
    if (ctx.research) parts.push(`\n## Research findings (from prior phase)\n${JSON.stringify(ctx.research)}`);
    if (ctx.discovery) parts.push(`\n## Discovery context (skills + vault selected)\n${JSON.stringify(ctx.discovery)}`);
    if (ctx.design) parts.push(`\n## Approved design\n${JSON.stringify(ctx.design)}`);
    if (ctx.skills) parts.push(`\n## Selected skills (loaded by discover)\n${ctx.skills}`);
  }
  return parts.join('\n');
}

// Convenience: check a phase prompt exists (throws same error as loadPhasePrompt).
export function assertPhaseExists(phase) {
  loadPhasePrompt(phase);
}
