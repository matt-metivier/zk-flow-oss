// tests/schemas.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SCHEMAS } from '../src/fragments/schemas.js';

test('review schema enforces the verdict enum', () => {
  assert.deepEqual(SCHEMAS.review.properties.verdict.enum, ['APPROVE','REQUEST_CHANGES','BLOCK']);
});
test('research schema requires the core fields', () => {
  assert.ok(SCHEMAS.research.required.includes('key_findings'));
});
test('every named schema is an object schema', () => {
  for (const k of ['research','design','implementation','review','testing','discover']) {
    assert.equal(SCHEMAS[k].type ?? 'object', 'object');
  }
});
