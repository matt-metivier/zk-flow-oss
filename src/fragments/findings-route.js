// src/fragments/findings-route.js
// Validators-never-fix (Factory.ai Missions): a reviewing/grading agent NEVER edits code.
// Non-APPROVE grader findings become a typed FixTask COMMENT on the parent bead (bd has no
// child-issue concept), tagged for scope-locked-editor. A future writer iteration picks them
// up. Dedupe key = phase+iteration so grade-loop reruns are visible but correlatable.
// Non-load-bearing telemetry -> persistPhaseSoft (never aborts the run on a write failure).
export async function routeFindingsToBead(beadId, grade, opts = {}) {
  if (!grade || grade.verdict === 'APPROVE') return { routed: 0 };
  const findings = (grade.findings || []).slice(0, 10);
  if (!findings.length) return { routed: 0 };
  const phase = opts.phase || 'review';
  const iteration = opts.iteration || 1;
  const payload = {
    owner: 'scope-locked-editor',
    phase,
    iteration,
    dedupe_key: `${phase}:${iteration}`,
    verdict: grade.verdict,
    findings: findings.map(f => ({
      title: f.title, severity: f.severity, file: f.file || null, line: f.line ?? null,
    })),
  };
  await persistPhaseSoft(beadId, 'FixTask', payload);
  return { routed: findings.length };
}
