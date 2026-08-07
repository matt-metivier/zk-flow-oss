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

// Graceful salvage (Factory.ai per-phase resilience): a null/undefined phase output becomes
// a {skipped:true} marker instead of throwing, so one dead agent doesn't lose a whole run —
// the failure mode that made a deep-research synthesis step emit placeholder junk and waste
// a full run. MUST be called BEFORE assertPhaseOutput (which early-returns on {skipped:true}).
// Only the null/undefined path is softened: a non-null non-object still throws in
// assertPhaseOutput, so genuinely malformed output is NOT masked.
export function salvagePhase(out, phaseName) {
  if (out === null || out === undefined) {
    console.warn(`[salvage:${phaseName}] phase returned null/undefined — salvaged as {skipped:true}; run continues.`);
    return { skipped: true, partial: null };
  }
  return out;
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
  const files = output && output.affirmed_files;  // schemas/design.json required field
  if (!files || !Array.isArray(files) || files.length === 0) {
    throw new Error(`[guardrail:${phaseName}] Design output missing affirmed_files. scope-locked-editor needs explicit file list before impl can start.`);
  }
}

// Scope enforcement. The old comment here deferred to "the scope-lock hook in
// .claude/settings.json" — that hook does not exist, so for as long as this said
// DEFERRED, nothing checked that impl stayed inside the design's affirmed_files.
// Dirs every impl may touch regardless of the design (mirrors the implementation rubric).
export const SCOPE_ALWAYS_ALLOWED = ['tests/', 'test/', 'docs/', 'CHANGELOG.md'];

// Returns a violations[] array instead of throwing, so a caller can route to handoff
// rather than killing a run that has already done the work. Empty array = in scope.
export function scopeViolations(changedFiles, allowedFiles) {
  if (!Array.isArray(changedFiles) || !Array.isArray(allowedFiles)) return [];
  const declared = allowedFiles
    .map(a => (typeof a === 'string' ? a : (a && a.file) || ''))
    .filter(Boolean);
  // No design contract -> no opinion. This MUST be checked on the caller's list before
  // the always-allowed dirs are merged in: testing `allowed.length` after the merge is
  // never zero, so an empty affirmed_files flagged EVERY changed file. That would have
  // broken `profile=small`, which has no design phase and therefore no affirmed_files.
  if (declared.length === 0) return [];
  const allowed = [...declared, ...SCOPE_ALWAYS_ALLOWED];
  return changedFiles
    .map(f => (typeof f === 'string' ? f : (f && f.file) || ''))
    .filter(Boolean)
    .filter(f => !allowed.some(a => f.startsWith(a) || a.startsWith(f) || f.includes('/' + a)));
}

export function assertScopeNotExceeded(changedFiles, allowedFiles, phaseName) {
  const violations = scopeViolations(changedFiles, allowedFiles);
  if (violations.length > 0) {
    throw new Error(`[guardrail:${phaseName}] Scope exceeded. Files changed outside allowed_files: ${violations.join(', ')}`);
  }
}

export function assertDiscoverValid(discovery, phaseName) {
  if (!discovery || typeof discovery !== 'object') {
    throw new Error(`[guardrail:${phaseName}] Discover output null/undefined.`);
  }
  const skills = discovery.skills || [];  // schemas/discover.json field is 'skills'
  const vault = discovery.vault_paths || [];
  if (skills.length === 0 && vault.length === 0) {
    // Soft warning — some tasks genuinely have no domain skills
    console.warn(`[guardrail:${phaseName}] Discover: no skills and no vault_paths. ` +
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
