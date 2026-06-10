// src/fragments/model-tiers.js
// Per-phase model tiers (fast/mid/deep). Exact model ids:
export const MODEL_TIERS = {
  fast: 'claude-haiku-4-5-20251001',  // cheap: ci-watch, persist, simple echoes
  mid:  'claude-sonnet-4-6',          // research, review perspectives, testing, impl
  deep: 'claude-opus-4-8',              // design, synthesis (arbiter/grader)
};
// Default tier per phase:
export const PHASE_TIER = {
  discover:'fast', research:'mid', design:'deep', impl:'mid', review:'mid',
  grade:'deep', testing:'mid', ci:'fast', persist:'fast', verify:'fast', grill:'mid',
};

// Posture profile per phase. Inspired by the precision/exploration conflict in
// arXiv:2604.01193 (Zhang et al. 2026, "Embarrassingly Simple Self-Distillation"):
// exploration phases benefit from diversity of candidates; precision phases benefit
// from suppressing distractor tails. The Agent spawn boundary exposes no temperature
// knob, so posture is injected as a prompt directive — not a sampling parameter.
//
//   exploration -> surface alternatives, name tradeoffs, resist premature commitment
//   precision   -> smallest correct output, no speculation, no drive-by changes
//   balanced    -> no directive (default)
export const PHASE_POSTURE = {
  discover:'exploration', research:'exploration', design:'exploration', grill:'exploration',
  impl:'precision', review:'precision', testing:'precision', grade:'precision',
  ci:'precision', persist:'precision', verify:'precision',
};

const POSTURE_DIRECTIVES = {
  exploration:
    'POSTURE: exploration. List at least 3 distinct approaches before committing; ' +
    'for each, state the tradeoff and the conditions under which you would reject it. ' +
    'Prefer breadth over premature convergence. Note assumptions you are uncertain about.',
  precision:
    'POSTURE: precision. Produce the minimum correct output. No alternatives, no ' +
    'speculation, no drive-by refactors, no unrequested abstractions. If the request ' +
    'is ambiguous, state the ambiguity and stop — do not pick.',
  balanced: '',
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

// Resolve a posture directive string for a phase, honoring args overrides:
//  - a.posture  = global override (one of: exploration | precision | balanced)
//  - a.postures = "design:exploration,impl:precision" per-phase override
// Returns '' for balanced or unknown phases (safe to splice unconditionally).
export function postureFor(phase, a = {}) {
  let name;
  if (a.postures) {
    const m = Object.fromEntries(String(a.postures).split(',').map(s => s.split(':').map(x=>x.trim())));
    if (m[phase]) name = m[phase];
  }
  if (!name && a.posture) name = String(a.posture).trim();
  if (!name) name = PHASE_POSTURE[phase] || 'balanced';
  return POSTURE_DIRECTIVES[name] || '';
}
