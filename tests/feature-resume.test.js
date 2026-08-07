// tests/feature-resume.test.js
// Structural tests for the feature workflow resume (startAt=impl) path.
// Verifies that defects are NOT present: research.out, design, and skillsBlock
// must all be wired before the impl runPhase call in the RUN 2 branch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildWorkflow, fragmentsFor } from '../build.js';

const ROOT = dirname(fileURLToPath(import.meta.url));
const REPO = join(ROOT, '..');

function getBuiltFeature() {
  return buildWorkflow('feature', fragmentsFor('feature'));
}

test('feature workflow builds without error', () => {
  assert.doesNotThrow(() => getBuiltFeature(), 'buildWorkflow should not throw');
});

test('skillsBlock is declared at outer scope (let skillsBlock)', () => {
  const src = readFileSync(join(REPO, 'src/workflows/feature.src.js'), 'utf8');
  assert.match(src, /^let skillsBlock;/m, 'skillsBlock must be declared with bare let at outer scope');
});

test('resume branch wires research = { out: loadedResearch }', () => {
  const src = readFileSync(join(REPO, 'src/workflows/feature.src.js'), 'utf8');
  // The wiring must appear after loadedResearch is assigned and before implResult runs
  const researchWire = /research\s*=\s*\{\s*out\s*:\s*loadedResearch\s*\}/;
  assert.match(src, researchWire, 'resume branch must set research = { out: loadedResearch }');
});

test('resume branch wires design = loadedDesign', () => {
  const src = readFileSync(join(REPO, 'src/workflows/feature.src.js'), 'utf8');
  assert.match(src, /^design\s*=\s*loadedDesign;/m, 'resume branch must set design = loadedDesign');
});

test('resume branch wires skillsBlock via renderSkills', () => {
  const src = readFileSync(join(REPO, 'src/workflows/feature.src.js'), 'utf8');
  assert.match(src, /^skillsBlock\s*=\s*await\s+renderSkills\(/m, 'resume branch must assign skillsBlock via renderSkills');
});

test('wiring assignments appear before implResult runPhase in RUN 2 branch', () => {
  const src = readFileSync(join(REPO, 'src/workflows/feature.src.js'), 'utf8');
  const wireIdx = src.indexOf('research = { out: loadedResearch }');
  const implIdx = src.indexOf('implResult = await runPhase(');
  assert.ok(wireIdx !== -1, 'wiring line must exist');
  assert.ok(implIdx !== -1, 'implResult runPhase must exist');
  assert.ok(wireIdx < implIdx, 'wiring must appear before implResult');
});

test('built feature workflow parses without error', () => {
  const out = getBuiltFeature();
  assert.doesNotThrow(() => {
    const stripped = out.replace(/^export\s+/gm, '');
    // eslint-disable-next-line no-new-func
    new Function('return (async () => { ' + stripped + ' })');
  }, 'built feature workflow must parse without error');
});
