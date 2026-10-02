// tests/testing-rubric.test.js
// Structural tests pinning the verdict mapping section in
// prompts/rubrics/testing-rubric.md to prevent regression.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RUBRIC = join(ROOT, 'prompts', 'rubrics', 'testing-rubric.md');

let src;
test('testing-rubric.md exists', () => {
  assert.ok(existsSync(RUBRIC), `expected ${RUBRIC} to exist`);
  src = readFileSync(RUBRIC, 'utf8');
});

test('rubric has a Verdict mapping section', () => {
  assert.match(src, /## Verdict mapping/i, 'must have ## Verdict mapping section');
});

test('verdict mapping includes BLOCK tier', () => {
  assert.match(src, /\*\*BLOCK\*\*/, 'must define BLOCK tier');
});

test('verdict mapping includes REQUEST_CHANGES tier', () => {
  assert.match(src, /\*\*REQUEST_CHANGES\*\*/, 'must define REQUEST_CHANGES tier');
});

test('verdict mapping includes APPROVE tier', () => {
  assert.match(src, /\*\*APPROVE\*\*/, 'must define APPROVE tier');
});

test('rubric explicitly states smoke_unsupported+exit0 is APPROVE', () => {
  // Must state that smoke_unsupported with exit code 0 is a pass.
  assert.match(
    src,
    /smoke_unsupported.*exit.*(0|zero|pass|APPROVE)|APPROVE.*smoke_unsupported/is,
    'must state smoke_unsupported+exit0 is APPROVE'
  );
});

test('rubric states trivial changes pass without smoke scenarios', () => {
  assert.match(
    src,
    /trivial/i,
    'must mention trivial change pass-through'
  );
});
