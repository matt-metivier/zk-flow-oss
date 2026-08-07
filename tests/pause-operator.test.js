// tests/pause-operator.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = dirname(fileURLToPath(import.meta.url));
const REPO = join(ROOT, '..');
const FRAGMENT = join(REPO, 'src/fragments/pause-operator.js');

test('pause-operator fragment exists', () => {
  assert.ok(existsSync(FRAGMENT), 'expected src/fragments/pause-operator.js to exist');
});

test('pauseForOperator returns a terminal waiting handoff object', async () => {
  if (!existsSync(FRAGMENT)) assert.fail('pause-operator fragment missing');
  const { pauseForOperator } = await import('../src/fragments/pause-operator.js');
  const calls = [];
  const result = await pauseForOperator({
    agent: async (prompt, opts) => { calls.push({ prompt, opts }); return { ok: true }; },
    handoffPrompt: (message, next) => `HANDOFF\n${message}\nNEXT ${next}`,
    phaseName: 'impl',
    beadId: 'zk-flow-123',
    resumeCommand: '/feature startAt=impl bead=zk-flow-123',
    reason: 'pauseBefore=impl',
    payload: { design: { summary: 'approved' }, grade: 'APPROVE' },
    model: 'test-model',
  });

  assert.deepEqual(result, {
    verdict: 'waiting_for_operator',
    phase: 'impl',
    bead: 'zk-flow-123',
    reason: 'pauseBefore=impl',
    next: 'run /feature startAt=impl bead=zk-flow-123',
    design: { summary: 'approved' },
    grade: 'APPROVE',
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].opts.label, 'handoff:pause-operator:impl');
  assert.equal(calls[0].opts.model, 'test-model');
  assert.match(calls[0].prompt, /NEXT \/feature startAt=impl bead=zk-flow-123/);
});

test('shouldPauseBefore matches phase names case-insensitively', async () => {
  if (!existsSync(FRAGMENT)) assert.fail('pause-operator fragment missing');
  const { shouldPauseBefore } = await import('../src/fragments/pause-operator.js');
  assert.equal(shouldPauseBefore('Impl', 'impl'), true);
  assert.equal(shouldPauseBefore('CI', 'impl'), false);
  assert.equal(shouldPauseBefore('impl', ''), false);
});

test('feature workflow wires pause-operator before impl resume path', () => {
  const src = readFileSync(join(REPO, 'src/workflows/feature.src.js'), 'utf8');
  assert.match(src, /@@USE: .*pause-operator/, 'feature @@USE must include pause-operator fragment');
  assert.match(src, /shouldPauseBefore\('impl',\s*a\.pauseBefore\)/, 'feature must check pauseBefore before impl');
  assert.match(src, /pauseForOperator\(/, 'feature must return pauseForOperator handoff');
});
