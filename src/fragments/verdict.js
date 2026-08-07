// src/fragments/verdict.js
// Verdict enum + review-gate routing.
// isSatisfied removed: no workflow calls it; routeVerdict is the canonical gate.
export function routeVerdict(verdict) {
  switch (verdict) {
    case 'APPROVE': return 'done';
    case 'REQUEST_CHANGES': return 'impl';
    case 'BLOCK': return 'needs_human';
    default: return 'needs_human';
  }
}
