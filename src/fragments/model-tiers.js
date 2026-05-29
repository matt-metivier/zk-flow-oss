// src/fragments/model-tiers.js
// Per-phase model tiers (fast/mid/deep). Exact model ids:
export const MODEL_TIERS = {
  fast: 'claude-haiku-4-5-20251001',  // cheap: ci-watch, persist, simple echoes
  mid:  'claude-sonnet-4-6',          // research, review perspectives, testing, impl
  deep: 'claude-opus-4-8',            // design, synthesis (arbiter/grader)
};
// Default tier per phase:
export const PHASE_TIER = {
  discover:'mid', research:'mid', design:'deep', impl:'mid', review:'mid',
  grade:'deep', testing:'mid', ci:'fast', persist:'fast', verify:'fast', grill:'mid',
};
// Resolve a model id for a phase, honoring args overrides:
//  - a.model = global override (a tier name OR a raw model id) applied to all phases
//  - a.models = "research:deep,impl:fast" per-phase tier overrides
export function modelFor(phase, a = {}) {
  const tierToId = (t) => MODEL_TIERS[t] || t; // allow raw id passthrough
  if (a.models) {
    const m = Object.fromEntries(String(a.models).split(',').map(s => s.split(':').map(x=>x.trim())));
    if (m[phase]) return tierToId(m[phase]);
  }
  if (a.model) return tierToId(a.model);
  return MODEL_TIERS[PHASE_TIER[phase]] || MODEL_TIERS.deep;
}
