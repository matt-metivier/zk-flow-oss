// src/fragments/budgets.js
// Phase budget caps (research/design/impl/review/testing/ci-watcher).
export const PHASE_BUDGETS = {
  research: 2, design: 3, impl: 2, review: 2, testing: 2, ci: 3, council: 3,
  // backtrack: max times a phase may re-run its PRIOR phase on exhausted-failure
  // before needs_human. 0 = OFF (default; behavior identical to no backtrack).
  backtrack: 0,
};
