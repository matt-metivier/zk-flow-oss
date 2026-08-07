// tests/schemas.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { SCHEMAS } from '../src/fragments/schemas.js';
import { buildWorkflow, fragmentsFor } from '../build.js';

const ROOT = dirname(fileURLToPath(import.meta.url));
const REPO = join(ROOT, '..');

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

test('build-time SCHEMAS literal includes every schemas/*.json file', () => {
  const schemaNames = readdirSync(join(REPO, 'schemas'))
    .filter(f => f.endsWith('.json'))
    .map(f => f.slice(0, -5))
    .sort();
  const bundle = buildWorkflow('feature', fragmentsFor('feature'));

  for (const name of schemaNames) {
    assert.ok(bundle.includes(`"${name}"`), `${name} schema must be inlined into workflow bundles`);
  }
  assert.ok(bundle.includes('"validation-contract"'), 'validation-contract schema must be available to feature/design');
  assert.ok(bundle.includes('"claim-vote"'), 'claim-vote schema must be available to claim verification');
});

test('discover calls keep StructuredOutput fields at top level', () => {
  for (const workflow of ['feature', 'design']) {
    const src = readFileSync(join(REPO, 'src/workflows', `${workflow}.src.js`), 'utf8');
    assert.match(src, /Call StructuredOutput with the schema fields at the TOP LEVEL/, `${workflow} discover prompt must require top-level schema fields`);
    assert.match(src, /do NOT wrap them in an output key/, `${workflow} discover prompt must forbid output-key wrapping`);
    assert.match(src, /schema: SCHEMAS\.discover/, `${workflow} discover agent call must pass the discover schema`);
  }
});
