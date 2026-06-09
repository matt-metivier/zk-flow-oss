// tests/posture.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PHASE_POSTURE, postureFor } from '../src/fragments/model-tiers.js';

// --- defaults from PHASE_POSTURE map ---
test('postureFor design default -> exploration directive', () => {
  const d = postureFor('design', {});
  assert.match(d, /POSTURE: exploration/);
  assert.match(d, /at least 3 distinct approaches/);
});
test('postureFor impl default -> precision directive', () => {
  const d = postureFor('impl', {});
  assert.match(d, /POSTURE: precision/);
  assert.match(d, /minimum correct output/);
});
test('postureFor research default -> exploration', () => {
  assert.match(postureFor('research', {}), /POSTURE: exploration/);
});
test('postureFor grade default -> precision', () => {
  assert.match(postureFor('grade', {}), /POSTURE: precision/);
});
test('postureFor unknown phase -> balanced (empty string)', () => {
  assert.equal(postureFor('nonexistent', {}), '');
});

// --- global override ---
test('global posture=precision forces precision on an exploration phase', () => {
  assert.match(postureFor('design', { posture: 'precision' }), /POSTURE: precision/);
});
test('global posture=exploration forces exploration on a precision phase', () => {
  assert.match(postureFor('impl', { posture: 'exploration' }), /POSTURE: exploration/);
});
test('global posture=balanced returns empty (suppresses default directive)', () => {
  assert.equal(postureFor('design', { posture: 'balanced' }), '');
});
test('global posture=unknown returns empty (safe fallback)', () => {
  assert.equal(postureFor('design', { posture: 'nonsense' }), '');
});

// --- per-phase override ---
test('postures=design:precision overrides design only', () => {
  const a = { postures: 'design:precision' };
  assert.match(postureFor('design', a), /POSTURE: precision/);
  assert.match(postureFor('impl', a), /POSTURE: precision/); // impl default unchanged
});
test('postures=impl:exploration overrides impl only', () => {
  const a = { postures: 'impl:exploration' };
  assert.match(postureFor('impl', a), /POSTURE: exploration/);
  assert.match(postureFor('design', a), /POSTURE: exploration/); // design default
});
test('postures multi: design:precision,impl:exploration', () => {
  const a = { postures: 'design:precision,impl:exploration' };
  assert.match(postureFor('design', a), /POSTURE: precision/);
  assert.match(postureFor('impl', a), /POSTURE: exploration/);
  assert.match(postureFor('research', a), /POSTURE: exploration/); // untouched default
});
test('per-phase postures wins over global posture', () => {
  const a = { posture: 'precision', postures: 'design:exploration' };
  assert.match(postureFor('design', a), /POSTURE: exploration/); // per-phase wins
  assert.match(postureFor('impl', a), /POSTURE: precision/);     // global applies
});
test('postures=phase:balanced suppresses default directive for that phase', () => {
  assert.equal(postureFor('design', { postures: 'design:balanced' }), '');
});

// --- PHASE_POSTURE map shape ---
test('PHASE_POSTURE covers every PHASE_TIER phase', async () => {
  const { PHASE_TIER } = await import('../src/fragments/model-tiers.js');
  for (const phase of Object.keys(PHASE_TIER)) {
    assert.ok(PHASE_POSTURE[phase], `missing posture for phase '${phase}'`);
  }
});
test('PHASE_POSTURE values are only exploration or precision', () => {
  for (const [phase, p] of Object.entries(PHASE_POSTURE)) {
    assert.ok(['exploration', 'precision'].includes(p), `phase '${phase}' has invalid posture '${p}'`);
  }
});
