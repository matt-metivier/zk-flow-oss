// tests/rubric-output-contract.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RUBRICS = join(ROOT, 'prompts', 'rubrics');

const IN_SCOPE = [
  'design-rubric.md',
  'implementation-rubric.md',
  'proposal-rubric.md',
  'research-rubric.md',
  'review-rubric.md',
  'testing-rubric.md',
];

function outputFormatBlock(file) {
  const src = readFileSync(join(RUBRICS, file), 'utf8');
  const match = src.match(/## Output format[\s\S]*?```json\n([\s\S]*?)\n```/);
  assert.ok(match, `${file} must have a JSON output format block`);
  return match[1];
}

function maybeOutputFormatBlock(file) {
  const src = readFileSync(join(RUBRICS, file), 'utf8');
  return src.match(/## Output format[\s\S]*?```json\n([\s\S]*?)\n```/)?.[1] ?? null;
}

test('six in-scope rubric output blocks use criteria_verdicts, not bare criteria', () => {
  for (const file of IN_SCOPE) {
    const block = outputFormatBlock(file);
    assert.match(block, /"criteria_verdicts"\s*:\s*\[/, `${file} must expose criteria_verdicts[]`);
    assert.doesNotMatch(block, /"criteria"\s*:\s*\[/, `${file} must not expose bare criteria[]`);
  }
});

test('criteria_verdicts examples include typed item fields and retain gaps_for_agent', () => {
  for (const file of IN_SCOPE) {
    const block = outputFormatBlock(file);
    for (const field of ['id', 'name', 'passed', 'evidence']) {
      assert.match(block, new RegExp(`"${field}"\\s*:`), `${file} must include ${field}`);
    }
    assert.match(block, /"gap"\s*:/, `${file} must show optional gap`);
    assert.match(block, /"gaps_for_agent"\s*:/, `${file} must retain gaps_for_agent`);
  }
});

test('out-of-scope rubrics are untouched', () => {
  const outOfScope = readdirSync(RUBRICS)
    .filter(file => file.endsWith('-rubric.md') && !IN_SCOPE.includes(file));

  assert.ok(outOfScope.length > 0, 'expected out-of-scope rubrics');
  for (const file of outOfScope) {
    const src = readFileSync(join(RUBRICS, file), 'utf8');
    assert.doesNotMatch(src, /"criteria_verdicts"\s*:/, `${file} should remain unchanged`);
  }
});
