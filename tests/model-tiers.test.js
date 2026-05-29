// tests/model-tiers.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MODEL_TIERS, PHASE_TIER, modelFor } from '../src/fragments/model-tiers.js';

// --- defaults ---
test('modelFor research default -> sonnet (mid)', () => {
  assert.equal(modelFor('research', {}), MODEL_TIERS.mid);
});
test('modelFor design default -> opus (deep)', () => {
  assert.equal(modelFor('design', {}), MODEL_TIERS.deep);
});
test('modelFor ci default -> haiku (fast)', () => {
  assert.equal(modelFor('ci', {}), MODEL_TIERS.fast);
});
test('modelFor persist default -> haiku (fast)', () => {
  assert.equal(modelFor('persist', {}), MODEL_TIERS.fast);
});
test('modelFor verify default -> haiku (fast)', () => {
  assert.equal(modelFor('verify', {}), MODEL_TIERS.fast);
});
test('modelFor grade default -> opus (deep)', () => {
  assert.equal(modelFor('grade', {}), MODEL_TIERS.deep);
});
test('modelFor impl default -> sonnet (mid)', () => {
  assert.equal(modelFor('impl', {}), MODEL_TIERS.mid);
});
test('modelFor unknown phase -> opus (deep fallback)', () => {
  assert.equal(modelFor('nonexistent', {}), MODEL_TIERS.deep);
});

// --- global override ---
test('global model=fast overrides all phases to haiku', () => {
  assert.equal(modelFor('research', { model: 'fast' }), MODEL_TIERS.fast);
  assert.equal(modelFor('design', { model: 'fast' }), MODEL_TIERS.fast);
});
test('global model=mid overrides to sonnet', () => {
  assert.equal(modelFor('impl', { model: 'mid' }), MODEL_TIERS.mid);
});
test('global model=deep overrides to opus', () => {
  assert.equal(modelFor('ci', { model: 'deep' }), MODEL_TIERS.deep);
});

// --- per-phase override ---
test('models=research:deep overrides research to opus', () => {
  assert.equal(modelFor('research', { models: 'research:deep' }), MODEL_TIERS.deep);
});
test('models=research:deep does not affect other phases', () => {
  assert.equal(modelFor('design', { models: 'research:deep' }), MODEL_TIERS.deep); // design default
  assert.equal(modelFor('ci', { models: 'research:deep' }), MODEL_TIERS.fast);    // ci default
});
test('models=impl:fast overrides impl to haiku', () => {
  assert.equal(modelFor('impl', { models: 'impl:fast' }), MODEL_TIERS.fast);
});
test('models multi: research:deep,impl:fast', () => {
  const a = { models: 'research:deep,impl:fast' };
  assert.equal(modelFor('research', a), MODEL_TIERS.deep);
  assert.equal(modelFor('impl', a), MODEL_TIERS.fast);
  assert.equal(modelFor('design', a), MODEL_TIERS.deep); // untouched default
});
test('per-phase models wins over global model', () => {
  const a = { model: 'fast', models: 'research:deep' };
  assert.equal(modelFor('research', a), MODEL_TIERS.deep); // per-phase wins
  assert.equal(modelFor('design', a), MODEL_TIERS.fast);   // global applies
});

// --- raw id passthrough ---
test('raw model id passthrough (global)', () => {
  assert.equal(modelFor('x', { model: 'claude-foo' }), 'claude-foo');
});
test('raw model id passthrough (per-phase)', () => {
  assert.equal(modelFor('research', { models: 'research:claude-foo' }), 'claude-foo');
});
