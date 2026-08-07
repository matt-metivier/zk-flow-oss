// tests/budgets.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PHASE_BUDGETS } from '../src/fragments/budgets.js';

test('per-phase budgets match the spec', () => {
  assert.deepEqual(PHASE_BUDGETS, {
    research: 2, design: 3, impl: 2, review: 2, testing: 2, ci: 3, council: 3,
    backtrack: 0,
  });
});

test('design budget floor guard', () => {
  assert.ok(PHASE_BUDGETS.design >= 3, 'design budget must stay >=3 for gate convergence');
});
