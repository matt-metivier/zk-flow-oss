// tests/model-tiers.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MODEL_TIERS, PHASE_TIER, TIER_ORDER, nextTier, modelFor } from '../src/fragments/model-tiers.js';

// --- nextTier ladder ---
test('nextTier fast -> mid', () => {
  assert.equal(nextTier('fast'), 'mid');
});
test('nextTier mid -> deep', () => {
  assert.equal(nextTier('mid'), 'deep');
});
test('nextTier deep -> null (top of ladder)', () => {
  assert.equal(nextTier('deep'), null);
});
test('nextTier unknown/raw id -> null', () => {
  assert.equal(nextTier('claude-opus-4-8'), null);
});
test('TIER_ORDER has three entries in ascending cost order', () => {
  assert.deepEqual(TIER_ORDER, ['fast', 'mid', 'deep']);
});

// --- tier ids ---
test('haiku is retired — no haiku in any tier', () => {
  assert.ok(!Object.values(MODEL_TIERS).some(id => id.includes('haiku')), 'no haiku anywhere');
  assert.equal(MODEL_TIERS.fast, 'claude-sonnet-4-6', 'fast = sonnet (tiered, not all-opus)');
});
test('discover defaults to mid tier (haiku fuzzed catalog ids)', () => {
  assert.equal(modelFor('discover', {}), MODEL_TIERS.mid);
});
test('tiered routing: deep=opus, mid/fast=sonnet (cost guard — no silent all-opus)', () => {
  assert.notEqual(MODEL_TIERS.deep, MODEL_TIERS.mid, 'deep must differ from mid — guards the all-opus regression (run-cost: ~3-5x)');
  assert.equal(MODEL_TIERS.deep, 'claude-opus-4-8', 'deep (design/grade synthesis) = opus');
  assert.equal(MODEL_TIERS.mid, 'claude-sonnet-4-6', 'mid (bulk phases) = sonnet — the cost saver');
  assert.equal(MODEL_TIERS.fast, 'claude-sonnet-4-6', 'fast = sonnet');
});

// --- defaults ---
test('modelFor research default -> sonnet (mid)', () => {
  assert.equal(modelFor('research', {}), MODEL_TIERS.mid);
});
test('modelFor design default -> opus (deep)', () => {
  assert.equal(modelFor('design', {}), MODEL_TIERS.deep);
});
test('modelFor ci default -> sonnet (fast tier)', () => {
  assert.equal(modelFor('ci', {}), MODEL_TIERS.fast);
});
test('modelFor persist default -> sonnet (fast tier)', () => {
  assert.equal(modelFor('persist', {}), MODEL_TIERS.fast);
});
test('modelFor verify default -> sonnet (fast tier)', () => {
  assert.equal(modelFor('verify', {}), MODEL_TIERS.fast);
});
test('modelFor grade default -> opus (deep)', () => {
  assert.equal(modelFor('grade', {}), MODEL_TIERS.deep);
});
test('modelFor impl default -> sonnet (mid)', () => {
  assert.equal(modelFor('impl', {}), MODEL_TIERS.mid);
});
test('modelFor unknown phase -> throws (fail fast, no silent deep-tier burn)', () => {
  assert.throws(() => modelFor('nonexistent', {}), /unknown phase 'nonexistent'/);
});

// --- global override ---
test('global model=fast overrides all phases to fast tier', () => {
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
test('models=impl:fast overrides impl to fast tier', () => {
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
// VAL-LAZY-005: intentional raw-id escape hatch — unknown tier name is NOT a known tier id
// Net-new assertion: the passthrough value must not appear in Object.values(MODEL_TIERS),
// confirming the escape hatch returned a literal raw id rather than coincidentally
// resolving to a tier-mapped model id. The === passthrough check is already covered
// at line 104 above; the membership conjunct here is the incremental content.
test('VAL-LAZY-005: per-phase unknown tier name passes through as raw id and is NOT a known tier model id (intentional escape hatch)', () => {
  const result = modelFor('research', { models: 'research:not-a-tier' });
  assert.equal(result, 'not-a-tier', 'passthrough returns the literal string');
  assert.ok(!Object.values(MODEL_TIERS).includes(result), 'passthrough value must not be a known tier model id');
});
