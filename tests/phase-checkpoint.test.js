// tests/phase-checkpoint.test.js
// Guards INSPIRE-lift item 5: per-phase checkpoints and finer-grained feature resume.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as bdMemory from '../src/fragments/bd-memory.js';

const ROOT = dirname(fileURLToPath(import.meta.url));
const REPO = join(ROOT, '..');
const read = (p) => readFileSync(join(REPO, p), 'utf8');

test('bd-memory exports per-phase checkpoint and resume helpers', () => {
  assert.equal(typeof bdMemory.bdPhaseCheckpoint, 'function');
  assert.equal(typeof bdMemory.bdPhaseResumeContext, 'function');
});

test('bdPhaseCheckpoint remembers a per-bead per-phase checkpoint with stable key', () => {
  assert.equal(typeof bdMemory.bdPhaseCheckpoint, 'function');
  const snippet = bdMemory.bdPhaseCheckpoint('zk-flow-abc', 'design', { verdict: 'APPROVE' });
  assert.ok(snippet.includes("bd remember 'PhaseCheckpoint: {\"bead\":\"zk-flow-abc\",\"phase\":\"design\",\"payload\":{\"verdict\":\"APPROVE\"}}' --key 'zk-flow-abc:phase:design'"), 'checkpoint must use bd remember with stable phase key');
  assert.ok(snippet.includes('bd remember failed for key zk-flow-abc:phase:design'), 'failure reason must anchor the checkpoint key');
});

test('bdPhaseCheckpoint validates bead id and shell-quotes phase and payload text', () => {
  assert.equal(typeof bdMemory.bdPhaseCheckpoint, 'function');
  assert.throws(() => bdMemory.bdPhaseCheckpoint('BadID', 'design', {}), /invalid bead id/);
  const snippet = bdMemory.bdPhaseCheckpoint('zk-flow-abc', "de'sign", { note: '$(whoami) `id`' });
  assert.ok(snippet.includes("--key 'zk-flow-abc:phase:de'\\''sign'"), 'phase key must be single-quote escaped');
  const stripped = snippet.replace(/'([^']|'\\'')*'/g, 'SQSPAN');
  assert.ok(!stripped.includes('$('), 'payload command substitution must stay quoted');
  assert.ok(!stripped.includes('`'), 'payload backticks must stay quoted');
});

test('bdPhaseResumeContext combines exact checkpoint memories with bounded bead context', () => {
  assert.equal(typeof bdMemory.bdPhaseResumeContext, 'function');
  const snippet = bdMemory.bdPhaseResumeContext('zk-flow-abc', 'impl', { nSame: 8, nCross: 2 });
  assert.ok(snippet.includes("bd memories 'zk-flow-abc:phase:impl'"), 'exact checkpoint memory lookup missing');
  assert.ok(snippet.includes("bd search 'zk-flow-abc impl checkpoint'"), 'bounded checkpoint search missing');
  assert.ok(snippet.includes('--limit 8'), 'custom same-subject limit missing');
  assert.ok(snippet.includes('--limit 2'), 'custom cross-subject limit missing');
});

test('bead-run exposes strict phase checkpoint persistence via bdPhaseCheckpoint', () => {
  const src = read('src/fragments/bead-run.js');
  assert.match(src, /export async function persistPhaseCheckpoint\(/, 'persistPhaseCheckpoint export missing');
  assert.match(src, /bdPhaseCheckpoint\(beadId, phase, payload\)/, 'checkpoint helper must use bdPhaseCheckpoint');
  assert.match(src, /\[checkpoint:\$\{phase\}\] bd checkpoint failed/, 'checkpoint persistence must be strict/load-bearing');
});

test('feature persists checkpoints after each completed phase', () => {
  const src = read('src/workflows/feature.src.js');
  for (const phase of ['Research', 'Discover', 'Design', 'Impl', 'ReviewGrade', 'Testing']) {
    assert.match(src, new RegExp(`persistPhaseCheckpoint\\(beadId, '${phase}'`), `feature must checkpoint ${phase}`);
  }
});

test('feature allows resume at every checkpoint boundary and requires bead for resume', () => {
  const src = read('src/workflows/feature.src.js');
  assert.match(src, /\['research', 'discover', 'design', 'impl', 'ci', 'review', 'testing'\]\.includes\(startAt\)/, 'startAt allow-list must cover checkpoint boundaries');
  assert.match(src, /startAt !== 'research' && !a\.bead/, 'non-research resume must require bead=');
});

test('feature loads phase resume context before resuming from bead', () => {
  const src = read('src/workflows/feature.src.js');
  const contextIdx = src.indexOf('const phaseResumeContext = await loadPhaseResumeContext(beadId, startAt);');
  const loadIdx = src.indexOf('const loadedResearch = await agent(');
  const implIdx = src.indexOf('implResult = await runPhase(');
  assert.ok(contextIdx !== -1, 'phase resume context load missing');
  assert.ok(loadIdx !== -1, 'schema load branch missing');
  assert.ok(implIdx !== -1, 'impl run missing');
  assert.ok(contextIdx < loadIdx, 'resume context must be loaded before schema reconstruction');
  assert.ok(contextIdx < implIdx, 'resume context must be loaded before resumed phase work');
  assert.match(src, /bdPhaseResumeContext\(beadId, phase/, 'resume context loader must use bdPhaseResumeContext');
});


test('feature resume at discover/design loads prior phase artifacts instead of rerunning all prior work', () => {
  const src = read('src/workflows/feature.src.js');
  assert.match(src, /if \(startAt === 'research'\) \{\n\s*\/\/ --- RESEARCH/, 'fresh research must be limited to startAt=research');
  assert.match(src, /const loadedDiscover = await agent\(/, 'startAt=design must load prior Discover artifact');
  assert.match(src, /if \(startAt !== 'design'\) \{\n\s*\/\/ --- DISCOVER/, 'discover phase should only rerun before the design boundary');
});
