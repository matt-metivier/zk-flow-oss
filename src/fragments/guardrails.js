// src/fragments/guardrails.js
// Phase-boundary assertion helpers. Zero external deps.
// Inspired by NeMo Guardrails (input/output/topical rails) and guardrails-ai (validator pattern).
// Workflows call these at phase transitions; failed assertions trigger handoff + early return.

export function assertPhaseOutput(output, phaseName) {
  if (!output || typeof output !== 'object') {
    throw new Error(`[guardrail:${phaseName}] Phase output is null/undefined or not an object. Agent may have failed to emit structured JSON.`);
  }
  if (output.verdict === 'needs_human' || output.skipped) return; // handoff already in progress
}

export function assertRequiredFields(output, requiredFields, phaseName) {
  if (!output) throw new Error(`[guardrail:${phaseName}] Output is null.`);
  const missing = requiredFields.filter(f => {
    const val = output[f];
    return val === undefined || val === null || (Array.isArray(val) && val.length === 0) || val === '';
  });
  if (missing.length > 0) {
    throw new Error(`[guardrail:${phaseName}] Required fields empty or missing: ${missing.join(', ')}. Agent output may be incomplete — check rubric and retry.`);
  }
}

export function assertEvidencePresent(output, phaseName) {
  // Research/design phases must have evidence before proceeding.
  const evidenceFields = ['key_findings', 'evidence', 'selected_skills'];
  const present = evidenceFields.filter(f => output && Array.isArray(output[f]) && output[f].length > 0);
  if (present.length === 0) {
    throw new Error(`[guardrail:${phaseName}] No evidence fields populated (key_findings, evidence, or selected_skills must be non-empty). Prevents empty-evidence APPROVE verdicts.`);
  }
}

export function assertTargetFiles(output, phaseName) {
  // Design phase must declare target files before impl.
  const files = output && (output.affirmed_files || output.target_files);
  if (!files || !Array.isArray(files) || files.length === 0) {
    throw new Error(`[guardrail:${phaseName}] Design output missing affirmed_files/target_files. scope-locked-editor needs explicit file list before impl can start.`);
  }
}

export function assertScopeNotExceeded(changedFiles, allowedFiles, phaseName) {
  if (!Array.isArray(changedFiles) || !Array.isArray(allowedFiles)) return;
  const violations = changedFiles.filter(f => !allowedFiles.some(a => f.startsWith(a) || a.startsWith(f)));
  if (violations.length > 0) {
    throw new Error(`[guardrail:${phaseName}] Scope exceeded. Files changed outside allowed_files: ${violations.join(', ')}`);
  }
}

// Wrap a phase agent call with assertion. Returns output or throws.
// Usage: const result = await guardedPhase('Research', researchOutput, () => assertEvidencePresent(researchOutput, 'Research'));
export async function guardedPhase(phaseName, output, ...assertFns) {
  assertPhaseOutput(output, phaseName);
  for (const fn of assertFns) fn();
  return output;
}
