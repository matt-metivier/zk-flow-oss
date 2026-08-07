// tests/review-rubric.test.js
// Guards the tiered verdict mapping in review-rubric.md — the 4th gate fixed
// for the same over-strictness as design (#22), testing (#26), impl (#30):
// a sound change must not be blocked on advisory (P2/P3) review findings.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const SRC = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'prompts/rubrics/review-rubric.md'), 'utf8');

test('review rubric has a tiered verdict mapping (not all-criteria-pass)', () => {
  assert.match(SRC, /## Verdict mapping/);
  assert.doesNotMatch(SRC, /`result` is `satisfied` when all criteria for the configured depth pass\./);
  assert.match(SRC, /satisfied` when the verdict is APPROVE/);
});

test('P0 blocks, P1 requests changes, advisory P2\\/P3 do not downgrade', () => {
  assert.match(SRC, /BLOCK[\s\S]*?P0/);
  assert.match(SRC, /REQUEST_CHANGES[\s\S]*?P1/);
  assert.match(SRC, /Advisory findings \(P2\/P3[\s\S]*?do\s*\n?\s*NOT downgrade/);
});
