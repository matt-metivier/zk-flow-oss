// src/fragments/budgets.js
// Phase budget caps (research/design/impl/review/testing/ci-watcher).
export const PHASE_BUDGETS = {
  research: 2, design: 3, impl: 2, review: 2, testing: 2, ci: 3, council: 3,
  // backtrack: max times a phase may re-run its PRIOR phase on exhausted-failure
  // before needs_human. 0 = OFF (default; behavior identical to no backtrack).
  backtrack: 0,
};

// Default token ceiling when the user's turn set no "+Nk"-style budget directive.
// Without this, `budget.total` is null and `budget.remaining()` is Infinity, so a
// stuck grade loop (or, worse, an escalation ladder) has no ceiling at all — a
// wrong-topic /research run once burned 675K tokens before a human caught it.
// 1M is a generous default for a full /feature-class run, not a tight cap.
const DEFAULT_TOKEN_BUDGET = 1_000_000;

// effectiveBudgetTotal/effectiveBudgetRemaining wrap the Workflow runtime's global
// `budget` object so every workflow gets a real ceiling even with no user directive.
// `budget` may be undefined in older sandboxes — guarded, not assumed present.
export function effectiveBudgetTotal() {
  return (typeof budget !== 'undefined' && budget && budget.total) || DEFAULT_TOKEN_BUDGET;
}
export function effectiveBudgetRemaining() {
  if (typeof budget === 'undefined' || !budget) return Infinity;
  const spent = budget.spent ? budget.spent() : 0;
  return Math.max(0, effectiveBudgetTotal() - spent);
}
// Cheap pre-flight check runPhase calls before EACH iteration/escalation step —
// a single boolean, not a percentage, so callers don't need to reason about
// how much runway is "enough" for one more agent() call.
export function budgetExhausted() {
  return effectiveBudgetRemaining() <= 0;
}
