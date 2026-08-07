// src/fragments/model-tiers.js
// NOTE: this relative fragment import is stripped at build time by
// stripFragmentImports (build.js); operatingInstructions resolves from shared
// bundle scope at runtime (operating-posture must be in each workflow's @@USE).
// It exists here so tests can import model-tiers.js as a real ESM module.
import { operatingInstructions } from './operating-posture.js';
// LAZY PROVIDER-IMPORT INVARIANT (VAL-LAZY-001)
// This module MUST remain import-time side-effect free:
//   - No process.env reads at module scope.
//   - No provider SDK imports or instantiations at module scope.
//   - No API-key access at module scope.
// Model-id resolution (modelFor) and posture/phase validation (postureFor) happen
// STRICTLY at call time on the matched branch, so missing env vars or absent SDKs
// fail at use, not at import. Callers receive plain model-id strings and pass them
// to the agent() runtime, which owns all provider SDK selection.
// The only permitted module-scope import is operatingInstructions from
// './operating-posture.js', which build.js strips from the bundle (see line 6).
// Any new module-scope import or env read is a violation of this invariant.
//
// Per-phase model tiers (fast/mid/deep). Exact model ids:
export const MODEL_TIERS = {
  // fast was haiku; retired 2026-06-11 — live runs showed haiku fuzzing skill ids
  // and misreading the StructuredOutput contract. Sonnet everywhere below deep.
  // 2026-06-12 all-opus directive REVERTED 2026-06-13: live run-cost showed
  // $19-30/run (~99.5% opus), ~3-5x tiered for marginal gain on routine phases.
  // Tiered restored: opus only for deep (design/grade synthesis); the bulk
  // (discover/research/impl/review/testing/ci) runs sonnet.
  fast: 'claude-sonnet-4-6',
  mid:  'claude-sonnet-4-6',          // research, review perspectives, testing, impl
  deep: 'claude-opus-4-8',              // design, synthesis (arbiter/grader)
};
// Default tier per phase:
export const PHASE_TIER = {
  discover:'mid', research:'mid', design:'deep', impl:'mid', review:'mid',
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
  // discover is mechanical selection against a strict schema — precision, not exploration
  discover:'precision', research:'exploration', design:'exploration', grill:'exploration',
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

// Escalation ladder: tier names in ascending cost order.
export const TIER_ORDER = ['fast', 'mid', 'deep'];

// Return the next tier name above `tier`, or null if already at the top or unknown.
// Keyed on tier NAME (not model id) because fast and mid share the same model id.
export function nextTier(tier) {
  const idx = TIER_ORDER.indexOf(tier);
  if (idx === -1 || idx === TIER_ORDER.length - 1) return null;
  return TIER_ORDER[idx + 1];
}

// Resolve a model id for a phase, honoring args overrides:
//  - a.model = global override (a tier name OR a raw model id) applied to all phases
//  - a.models = "research:deep,impl:fast" per-phase tier overrides
export function modelFor(phase, a = {}) {
  // DELIBERATE ESCAPE HATCH: if `t` is not a known tier name, return it verbatim
  // as a raw model id. This allows callers to pass a literal model id (e.g.
  // 'claude-foo') where a tier name is normally expected, without requiring an
  // explicit tier entry. The passthrough is INTENTIONAL — asserted by test
  // VAL-LAZY-005 — and must NOT be replaced with a throw or a silent tier
  // default; the caller is assumed to know what they are doing.
  const tierToId = (t) => MODEL_TIERS[t] || t;
  if (a.models) {
    const m = Object.fromEntries(String(a.models).split(',').map(s => s.split(':').map(x=>x.trim())));
    if (m[phase]) return tierToId(m[phase]);
  }
  if (a.model) return tierToId(a.model);
  if (!(phase in PHASE_TIER)) throw new Error(`modelFor: unknown phase '${phase}' — add it to PHASE_TIER (silent fallback would burn the deep tier)`);
  return MODEL_TIERS[PHASE_TIER[phase]];
}

// Resolve a posture string for a phase, honoring args overrides:
//  - a.posture  = global override (one of: exploration | precision | balanced)
//  - a.postures = "design:exploration,impl:precision" per-phase override
// The operating block is a FLOOR: always present (even for balanced/unknown
// phases). The per-phase posture DIRECTIVE stays separately suppressible — it
// is '' for balanced/unknown and is omitted from the join with no trailing
// whitespace. So balanced still zeroes the directive but never the floor.
export function postureFor(phase, a = {}) {
  let name;
  if (a.postures) {
    const m = Object.fromEntries(String(a.postures).split(',').map(s => s.split(':').map(x=>x.trim())));
    if (m[phase]) name = m[phase];
  }
  if (!name && a.posture) name = String(a.posture).trim();
  if (name && !(name in POSTURE_DIRECTIVES)) throw new Error(`postureFor: unknown posture '${name}' — valid: exploration | precision | balanced`);
  if (!name) name = PHASE_POSTURE[phase] || 'balanced';
  const directive = POSTURE_DIRECTIVES[name];
  const block = operatingInstructions();
  return directive ? block + '\n\n' + directive : block;
}
