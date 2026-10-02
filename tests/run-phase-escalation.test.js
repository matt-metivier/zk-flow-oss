// tests/run-phase-escalation.test.js
// Structural PRESENCE tests for the escalation ladder wired into run-phase.js.
// No executable agent() mock exists in this suite — behavioral return values are NOT asserted.
// These tests pin the presence of the escalation pattern, mirroring feature-resume.test.js style.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = dirname(fileURLToPath(import.meta.url));
const SRC = join(ROOT, '..', 'src', 'fragments', 'run-phase.js');

function src() {
  return readFileSync(SRC, 'utf8');
}

test('run-phase.js exports runPhase with canEscalate parameter', () => {
  assert.ok(src().includes('canEscalate = false'), 'canEscalate default must be false (opt-in)');
});

test('run-phase.js exports runPhase with startTier parameter', () => {
  assert.ok(src().includes('startTier = null'), 'startTier default must be null');
});

test('run-phase.js throws when canEscalate=true and startTier is missing', () => {
  assert.ok(src().includes('canEscalate && !startTier'), 'fail-fast guard must check canEscalate && !startTier');
});

test('run-phase.js escalation loop calls nextTier', () => {
  assert.ok(src().includes('nextTier(curTier)'), 'escalation loop must call nextTier(curTier)');
});

test('run-phase.js escalation uses MODEL_TIERS to re-resolve model id', () => {
  assert.ok(src().includes('MODEL_TIERS[curTier]'), 'escalation must re-resolve model id from MODEL_TIERS');
});

test('run-phase.js GraderFeedback payload includes escalated/fromTier/toTier fields', () => {
  const s = src();
  assert.ok(s.includes('escalated: true'), 'GraderFeedback must carry escalated:true');
  assert.ok(s.includes('fromTier'), 'GraderFeedback must carry fromTier');
  assert.ok(s.includes('toTier: curTier'), 'GraderFeedback must carry toTier');
});

test('run-phase.js escalated return shape includes escalated/fromTier/toTier', () => {
  const s = src();
  assert.ok(s.includes('escalated: true, fromTier, toTier: curTier'), 'APPROVE return on escalation must include escalated/fromTier/toTier');
});

test('run-phase.js non-escalation return shape includes escalated:false', () => {
  assert.ok(src().includes('escalated: false'), 'non-escalation return must include escalated:false');
});

test('run-phase.js gradeModel invariant comment present', () => {
  assert.ok(src().includes('gradeModel is a FIXED invariant'), 'code comment must document gradeModel invariant');
});
