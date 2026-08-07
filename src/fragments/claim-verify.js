// src/fragments/claim-verify.js
// Abstention-aware adversarial verification of research findings BEFORE they reach design.
// Pattern lifted from the deep-research workflow (eval verdict: INSPIRE) and Factory.ai
// Missions (fresh unbiased validators): N skeptic voters per claim, default-REFUTE, and a
// claim survives ONLY with a quorum of valid (non-abstaining) votes AND fewer than the
// refute threshold. All-ABSTAIN must FAIL, not silently pass — that is the whole point of
// the `valid.length >= refuteThreshold` guard. Killed claims do not reach research_complete.
//
// PURE helpers (claimSurvives, rankFindings) are unit-tested directly.
// verifyClaims is integration-only (fans out agent() voters); it is never unit-tested.

// Pure: does a claim survive its votes? ABSTAIN counts as neither CONFIRM nor REFUTE.
// Quorum guard: need at least `refuteThreshold` VALID votes to adjudicate at all, so an
// all-abstain (or no-vote) claim returns false instead of slipping through on refuted===0.
export function claimSurvives(votes, refuteThreshold) {
  const r = Number(refuteThreshold) || 2;
  const valid = (votes || []).filter(v => v && (v.verdict === 'REFUTE' || v.verdict === 'CONFIRM'));
  const refuted = valid.filter(v => v.verdict === 'REFUTE').length;
  return valid.length >= r && refuted < r;
}

// Pure: rank findings so the maxClaims cap keeps the load-bearing ones (strong evidence first).
export function rankFindings(findings) {
  const q = { strong: 0, adequate: 1, weak: 2 };
  const score = (f) => (f && q[f.evidence_quality] !== undefined ? q[f.evidence_quality] : 3);
  return [...(findings || [])].sort((a, b) => score(a) - score(b));
}

// Thin voter prompt for one finding (request body appended to the claim-vote phase prompt).
export function claimVotePrompt(finding, claimId, voter, votesPer, refuteThreshold) {
  return `Claim #${claimId} under review (voter ${voter + 1}/${votesPer}):\n` +
    `"${finding && finding.finding}"\n` +
    `Evidence cited: ${(finding && finding.evidence) || '(none)'} ` +
    `[${(finding && finding.evidence_quality) || 'unrated'}]\n` +
    `Be skeptical. Default to REFUTE if uncertain. ${refuteThreshold}/${votesPer} REFUTE votes kill this claim.\n` +
    `Emit a claim-vote: {claim_id:"${claimId}", verdict: REFUTE|CONFIRM|ABSTAIN, confidence, rationale}.`;
}

// Integration: fan out voters, strip killed claims. Returns one of:
//   {kept,killed,verified:true}                  — at least one claim survived
//   {skipped:true,partial:{killed}}              — no findings, or every claim killed
// On all-killed we SALVAGE (return skipped) rather than zeroing research — the caller keeps
// the original findings and the persisted ClaimVerify counts surface the adversarial wipeout.
export async function verifyClaims(researchOut, opts = {}) {
  const votesPer = Number(opts.verifyVotes) || 2;
  const maxClaims = Number(opts.maxClaims) || 10;
  const refuteThreshold = Number(opts.refuteThreshold) || 2;
  const findings = (researchOut && researchOut.key_findings) || [];
  if (!findings.length) return { skipped: true, partial: null, kept: [], killed: [] };
  const ranked = rankFindings(findings).slice(0, maxClaims);
  const results = (await parallel(ranked.map((f, ci) => () =>
    parallel(Array.from({ length: votesPer }, (_, v) => () =>
      agent(
        loadPhasePrompt('claim-vote', { request: claimVotePrompt(f, ci, v, votesPer, refuteThreshold) }),
        { label: `claim-vote:${ci}:${v}`, agentType: 'critic', model: opts.model, schema: SCHEMAS['claim-vote'] }
      )
    )).then(votes => ({ finding: f, votes: (votes || []).filter(Boolean) }))
  ))).filter(Boolean);
  const killed = results.filter(r => !claimSurvives(r.votes, refuteThreshold)).map(r => r.finding);
  // Strip ONLY adversarially-killed findings. Findings beyond the maxClaims cap are
  // unverified but NOT dropped (silent deletion of unjudged findings would lose research).
  const killedSet = new Set(killed);
  const kept = findings.filter(f => !killedSet.has(f));
  if (kept.length === 0) return { skipped: true, partial: { killed }, kept: [], killed };
  const dropped = ranked.length < findings.length ? findings.length - ranked.length : 0;
  if (dropped > 0) log(`[claim-verify] ${dropped} finding(s) beyond maxClaims=${maxClaims} kept UNVERIFIED (not voted on).`);
  return { kept, killed, verified: true };
}
