// tests/posture.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PHASE_POSTURE, PHASE_TIER, postureFor } from '../src/fragments/model-tiers.js';
import { operatingInstructions } from '../src/fragments/operating-posture.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const stripExports = (s) => s.replace(/^export\s+/gm, '');
const stripFragmentImports = (s) => s.replace(/^import\s+\{[^}]*\}\s+from\s+'\.\/[\w-]+\.js';?\s*$/gm, '');

// The operating block is a FLOOR: present in every postureFor output. The
// per-phase posture DIRECTIVE ('POSTURE: ...') stays separately suppressible.
const BLOCK_MARKER = /OPERATING POSTURE \(always on\):/;
const hasDirective = (s) => /POSTURE: (exploration|precision)/.test(s);

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
test('postureFor unknown phase -> no directive, but floor block present', () => {
  const d = postureFor('nonexistent', {});
  assert.ok(!hasDirective(d), 'unknown phase must carry NO posture directive');
  assert.match(d, BLOCK_MARKER, 'floor block must still be present');
});

// --- global override ---
test('global posture=precision forces precision on an exploration phase', () => {
  assert.match(postureFor('design', { posture: 'precision' }), /POSTURE: precision/);
});
test('global posture=exploration forces exploration on a precision phase', () => {
  assert.match(postureFor('impl', { posture: 'exploration' }), /POSTURE: exploration/);
});
test('global posture=balanced suppresses directive but keeps the floor block', () => {
  const d = postureFor('design', { posture: 'balanced' });
  assert.ok(!hasDirective(d), 'balanced must zero the posture directive');
  assert.match(d, BLOCK_MARKER, 'floor block survives a balanced override');
});
test('global posture=unknown throws (fail fast on typo)', () => {
  assert.throws(() => postureFor('design', { posture: 'nonsense' }), /unknown posture 'nonsense'/);
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
test('postures=phase:balanced suppresses directive but keeps the floor block', () => {
  const d = postureFor('design', { postures: 'design:balanced' });
  assert.ok(!hasDirective(d), 'per-phase balanced must zero the directive');
  assert.match(d, BLOCK_MARKER, 'floor block survives a per-phase balanced override');
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

// --- operating block (the shared posture floor) ---
const GROUP_MARKERS = [/VERIFY BEFORE CLAIM/, /SCOPE & SAFETY/, /JUDGMENT/, /COMMUNICATION/];

test('operatingInstructions() contains all 4 pattern-group markers', () => {
  const b = operatingInstructions();
  for (const m of GROUP_MARKERS) assert.match(b, m, `missing group marker ${m}`);
});
test('operatingInstructions() is terse (~10-12 lines, hard cap 16)', () => {
  const lines = operatingInstructions().split('\n').length;
  assert.ok(lines >= 5 && lines <= 16, `block has ${lines} lines (token cost paid on every call)`);
});
test('operatingInstructions() has no trailing whitespace', () => {
  const b = operatingInstructions();
  assert.equal(b, b.replace(/\s+$/, ''), 'block must not end with whitespace');
});

test('postureFor floor: every PHASE_TIER phase carries the operating block', () => {
  for (const phase of Object.keys(PHASE_TIER)) {
    const out = postureFor(phase, {});
    assert.match(out, BLOCK_MARKER, `phase '${phase}' missing operating block`);
    for (const m of GROUP_MARKERS) assert.match(out, m, `phase '${phase}' missing group ${m}`);
  }
});
test('postureFor floor: no trailing whitespace when directive is suppressed', () => {
  const out = postureFor('design', { posture: 'balanced' });
  assert.equal(out, operatingInstructions(), 'balanced output must equal the bare block, no trailing sep');
});

// --- bundle-eval: the block must reach runtime when fragments share one scope ---
// Concatenate the inlined fragments exactly as build.js does (stripExports +
// stripFragmentImports), then eval postureFor in that shared scope. This proves
// (a) the cross-fragment import is stripped, and (b) operatingInstructions
// resolves from bundle scope at runtime — the ESM-vs-bundle gap. We eval only
// the two fragments (not a full workflow) to avoid executing workflow top-level.
test('bundle scope: postureFor resolves operatingInstructions with import stripped', () => {
  const inline = (f) =>
    stripFragmentImports(stripExports(readFileSync(join(ROOT, 'src/fragments', `${f}.js`), 'utf8')));
  const scope = [inline('model-tiers'), inline('operating-posture')].join('\n\n');
  assert.doesNotMatch(scope, /^import\s/m, 'inlined fragments must be import-free');
  const fn = new Function(scope + '\n; return postureFor("impl", {});');
  const result = fn();
  assert.match(result, BLOCK_MARKER, 'bundle-scope postureFor must emit the block');
  for (const m of GROUP_MARKERS) assert.match(result, m, `bundle output missing group ${m}`);
});
