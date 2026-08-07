// tests/handoff.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handoffPrompt } from '../src/fragments/handoff.js';

test('handoffPrompt mentions $TMPDIR', () => {
  const p = handoffPrompt('feature complete', 'run tests');
  assert.ok(p.includes('$TMPDIR'), 'must mention $TMPDIR');
});
test('handoffPrompt references the handoff skill path', () => {
  const p = handoffPrompt('feature complete', 'run tests');
  assert.ok(p.includes('$ZK_ARTIFACTS_DIR/skills/general/practices/handoff/SKILL.md'), 'must include skill path');
});
test('handoffPrompt includes the summary', () => {
  const p = handoffPrompt('feature complete', 'run tests');
  assert.ok(p.includes('feature complete'), 'must include summary');
});
test('handoffPrompt includes the suggested next step', () => {
  const p = handoffPrompt('feature complete', 'run tests');
  assert.ok(p.includes('run tests'), 'must include suggested next');
});
