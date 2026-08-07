// tests/depth-map.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { REVIEW_DEPTHS, DEFAULT_PERSPECTIVES, criteriaForDepth, validPerspectives } from '../src/fragments/depth-map.js';

test('standard depth is the default 7 criteria', () => {
  assert.deepEqual(criteriaForDepth('standard'),
    ['correctness','obvious-bugs','security','scope-alignment','error-handling','api-contract','simplification']);
});
test('full depth adds performance/deployment-risk/maintainability', () => {
  assert.deepEqual(criteriaForDepth('full').slice(7),
    ['performance','deployment-risk','maintainability']);
});
test('light is the shallow pair', () => {
  assert.deepEqual(criteriaForDepth('light'), ['correctness','obvious-bugs']);
});
test('none is empty', () => { assert.deepEqual(criteriaForDepth('none'), []); });
test('unknown depth throws', () => { assert.throws(() => criteriaForDepth('deep')); });
test('default perspectives are the 6 (no arbiter)', () => {
  assert.deepEqual(DEFAULT_PERSPECTIVES,
    ['advocate','critic','security','performance','learning','simplify']);
});
test('validPerspectives filters out unknown perspectives like architecture', () => {
  const input = ['advocate', 'architecture', 'critic', 'persona'];
  const result = validPerspectives(input);
  assert.ok(!result.includes('architecture'), 'architecture should be filtered out');
  assert.ok(result.includes('advocate'), 'advocate should pass');
  assert.ok(result.includes('critic'), 'critic should pass');
  assert.ok(result.includes('persona'), 'persona should pass');
});
test('validPerspectives returns DEFAULT_PERSPECTIVES when all inputs are invalid', () => {
  const result = validPerspectives(['architecture']);
  assert.deepEqual(result, DEFAULT_PERSPECTIVES, 'all-invalid input must fall back to DEFAULT_PERSPECTIVES, never empty');
});
