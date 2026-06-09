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

// DEFERRED: scope enforcement is handled by scope-lock hook in .claude/settings.json
export function assertScopeNotExceeded(changedFiles, allowedFiles, phaseName) {
  if (!Array.isArray(changedFiles) || !Array.isArray(allowedFiles)) return;
  const violations = changedFiles.filter(f => !allowedFiles.some(a => f.startsWith(a) || a.startsWith(f)));
  if (violations.length > 0) {
    throw new Error(`[guardrail:${phaseName}] Scope exceeded. Files changed outside allowed_files: ${violations.join(', ')}`);
  }
}

// Wrap a phase agent call with assertion. Returns output or throws.
// Usage: const result = await guardedPhase('Research', researchOutput, () => assertEvidencePresent(researchOutput, 'Research'));
// DEFERRED: utility wrapper, not yet wired into workflows
export async function guardedPhase(phaseName, output, ...assertFns) {
  assertPhaseOutput(output, phaseName);
  for (const fn of assertFns) fn();
  return output;
}

export function assertDiscoverValid(discovery, phaseName) {
  if (!discovery || typeof discovery !== 'object') {
    throw new Error(`[guardrail:${phaseName}] Discover output null/undefined.`);
  }
  const skills = discovery.selected_skills || discovery.skills || [];
  const vault = discovery.vault_paths || [];
  if (skills.length === 0 && vault.length === 0) {
    // Soft warning — some tasks genuinely have no domain skills
    console.warn(`[guardrail:${phaseName}] Discover: no selected_skills and no vault_paths. ` +
      'Verify Map of Contents was checked and skills glob returned results.');
  }
  if (!discovery.rationale && !discovery.reason) {
    throw new Error(`[guardrail:${phaseName}] Discover output missing rationale. ` +
      'Agent must explain why skills/vault paths were selected (or why none matched).');
  }
}

export function assertEvidenceQuality(output, phaseName) {
  if (!output) return;
  const quality = output.evidence_quality;
  if (quality === 'weak') {
    throw new Error(
      `[guardrail:${phaseName}] evidence_quality = weak. Agent produced unverified claims. ` +
      'Every finding needs file:line citation or vault path. Grader should also catch this.'
    );
  }
  if (output.key_findings) {
    const weakFindings = (output.key_findings || []).filter(f => f.evidence_quality === 'weak');
    if (weakFindings.length > 0) {
      throw new Error(
        `[guardrail:${phaseName}] ${weakFindings.length} finding(s) have evidence_quality=weak. ` +
        'All findings must be backed by file:line or vault evidence.'
      );
    }
  }
}

// DEFERRED: model not exposed by workflow runtime — advisory only
export function assertModelRespected(out, expectedPhase) {
  // Can't enforce model from workflow JS — just surface a warning in the output receipt
  // if the agent emitted a model_used field that differs from expected tier.
  // Agents don't currently emit model_used, so this is advisory only.
  if (out && out.model_used && out.model_used.includes('haiku')) {
    console.warn(
      `[guardrail:${expectedPhase}] Agent reported using haiku for a phase that may need deeper reasoning. ` +
      'If output quality is low, retry with model=deep.'
    );
  }
}

export function assertFindings(gradeOutput, phaseName) {
  if (!gradeOutput) return;
  const { verdict, findings } = gradeOutput;
  if (verdict && verdict !== 'APPROVE' && (!findings || findings.length === 0)) {
    throw new Error(
      `[guardrail:${phaseName}] Grader emitted ${verdict} with empty findings[]. ` +
      'Every REQUEST_CHANGES or BLOCK verdict must cite specific findings.'
    );
  }
}
