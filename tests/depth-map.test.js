// tests/depth-map.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { REVIEW_DEPTHS, DEFAULT_PERSPECTIVES, criteriaForDepth, validPerspectives } from '../src/fragments/depth-map.js';

test('standard depth is the default 6 criteria', () => {
  assert.deepEqual(criteriaForDepth('standard'),
    ['correctness','obvious-bugs','security','scope-alignment','error-handling','api-contract']);
});
test('full depth adds performance/deployment-risk/maintainability', () => {
  assert.deepEqual(criteriaForDepth('full').slice(6),
    ['performance','deployment-risk','maintainability']);
});
test('light is the shallow pair', () => {
  assert.deepEqual(criteriaForDepth('light'), ['correctness','obvious-bugs']);
});
test('none is empty', () => { assert.deepEqual(criteriaForDepth('none'), []); });
test('unknown depth throws', () => { assert.throws(() => criteriaForDepth('deep')); });
test('default perspectives are the 5 (no arbiter)', () => {
  assert.deepEqual(DEFAULT_PERSPECTIVES,
    ['advocate','critic','security','performance','learning']);
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
