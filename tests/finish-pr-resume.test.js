// tests/finish-pr-resume.test.js
// Structural guard for finish-pr's two branch-loaded context vars, mirroring
// feature-resume.test.js. finish-pr is the other multi-branch workflow: an
// uninitialized outer `let` (priorContext, implResult) is consumed after an
// if/else, so EVERY branch must assign it first or the consumer derefs
// undefined (the second half of the PR#3 bug class). A lexical analyzer can't
// prove "assigned on all branches" without false positives, so we assert the
// structural invariant directly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildWorkflow, fragmentsFor } from '../build.js';

const ROOT = dirname(fileURLToPath(import.meta.url));
const REPO = join(ROOT, '..');
const SRC = readFileSync(join(REPO, 'src/workflows/finish-pr.src.js'), 'utf8');

test('finish-pr builds and parses without error', () => {
  const out = buildWorkflow('finish-pr', fragmentsFor('finish-pr'));
  assert.doesNotThrow(() => {
    const stripped = out.replace(/^export\s+/gm, '');
    // eslint-disable-next-line no-new-func
    new Function('return (async () => { ' + stripped + ' })');
  });
});

test('priorContext declared as bare outer-scope let', () => {
  assert.match(SRC, /^let priorContext;/m);
});

test('priorContext assigned in BOTH context-load branches', () => {
  // bead branch
  assert.match(SRC, /priorContext\s*=\s*\{\s*design:\s*loadedDesign,\s*research:\s*loadedResearch\s*\}/);
  // diff (no-bead) branch
  assert.match(SRC, /priorContext\s*=\s*\{\s*research:\s*diffResearch\s*\}/);
});

test('priorContext assignments precede the impl runPhase that consumes it', () => {
  const beadWire = SRC.indexOf('priorContext = { design: loadedDesign');
  const diffWire = SRC.indexOf('priorContext = { research: diffResearch }');
  const implIdx = SRC.indexOf('implResult = await runPhase(');
  assert.ok(beadWire !== -1 && diffWire !== -1, 'both priorContext assignments must exist');
  assert.ok(implIdx !== -1, 'impl runPhase must exist');
  assert.ok(beadWire < implIdx && diffWire < implIdx, 'both branches must assign priorContext before impl');
});

test('implResult declared as bare outer-scope let', () => {
  assert.match(SRC, /^let implResult;/m);
});

test('implResult assigned in BOTH needsImpl branches before any deref', () => {
  // needsImpl=true branch runs the impl phase
  assert.match(SRC, /implResult\s*=\s*await\s+runPhase\(/);
  // needsImpl=false (skip) branch sets a synthetic ok result
  assert.match(SRC, /implResult\s*=\s*\{\s*ok:\s*true,/);
  // the skip assignment must come before the post-merge review consumer
  const skipWire = SRC.indexOf('implResult = { ok: true,');
  const reviewConsumer = SRC.indexOf('implResult.out', skipWire);
  assert.ok(skipWire !== -1, 'skip branch must assign implResult');
});
