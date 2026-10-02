// src/fragments/phase-router.js
// Declarative routing for homogeneous phase-result boundaries.
const DEFAULT_PHASE_ROUTE = { verdict: 'needs_human', phase: 'unknown' };

export const and_ = (...predicates) => (ret) => predicates.every((predicate) => predicate(ret));
export const or_ = (...predicates) => (ret) => predicates.some((predicate) => predicate(ret));

export function routePhase(gates, ret) {
  if (!Array.isArray(gates)) return { ...DEFAULT_PHASE_ROUTE };

  for (const gate of gates) {
    if (!gate || typeof gate.when !== 'function') continue;

    try {
      if (!gate.when(ret)) continue;

      const route = typeof gate.route === 'function' ? gate.route(ret) : gate.route;
      return route && typeof route === 'object' ? { ...route } : { ...DEFAULT_PHASE_ROUTE };
    } catch (_err) {
      return { ...DEFAULT_PHASE_ROUTE };
    }
  }

  return { ...DEFAULT_PHASE_ROUTE };
}
