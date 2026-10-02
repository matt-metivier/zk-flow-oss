// tests/verdict.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { routeVerdict } from '../src/fragments/verdict.js';

test('routeVerdict maps review verdicts to next stage', () => {
  assert.equal(routeVerdict('APPROVE'), 'done');
  assert.equal(routeVerdict('REQUEST_CHANGES'), 'impl');
  assert.equal(routeVerdict('BLOCK'), 'needs_human');
});
test('routeVerdict unknown -> needs_human (fail safe)', () => {
  assert.equal(routeVerdict('weird'), 'needs_human');
});
test('routeVerdict null/undefined -> needs_human', () => {
  assert.equal(routeVerdict(null), 'needs_human');
  assert.equal(routeVerdict(undefined), 'needs_human');
});
