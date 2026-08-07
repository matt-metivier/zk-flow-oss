// tests/claim-verify.test.js
// Pure-function tests for the abstention-aware adversarial quorum and graceful salvage.
// verifyClaims itself is integration-only (fans out agent() voters) and is NOT tested here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { claimSurvives, rankFindings } from '../src/fragments/claim-verify.js';
import { salvagePhase, assertPhaseOutput } from '../src/fragments/guardrails.js';

const V = (verdict) => ({ verdict });

test('all-ABSTAIN never survives (the quorum guard, not refuted===0)', () => {
  assert.equal(claimSurvives([V('ABSTAIN'), V('ABSTAIN')], 2), false);
});

test('no votes never survives', () => {
  assert.equal(claimSurvives([], 2), false);
  assert.equal(claimSurvives(null, 2), false);
});

test('2 REFUTE kills (>= threshold)', () => {
  assert.equal(claimSurvives([V('REFUTE'), V('REFUTE')], 2), false);
});

test('2 CONFIRM, 0 REFUTE survives', () => {
  assert.equal(claimSurvives([V('CONFIRM'), V('CONFIRM')], 2), true);
});

test('1 CONFIRM + 1 ABSTAIN does NOT meet quorum (only 1 valid vote)', () => {
  assert.equal(claimSurvives([V('CONFIRM'), V('ABSTAIN')], 2), false);
});

test('1 CONFIRM + 1 REFUTE: quorum met, refutes (1) < threshold (2) -> survives', () => {
  assert.equal(claimSurvives([V('CONFIRM'), V('REFUTE')], 2), true);
});

test('null/garbage votes are filtered before counting', () => {
  assert.equal(claimSurvives([null, V('CONFIRM'), V('CONFIRM')], 2), true);
  assert.equal(claimSurvives([{}, V('ABSTAIN')], 2), false);
});

test('rankFindings orders strong < adequate < weak < unrated', () => {
  const out = rankFindings([
    { finding: 'w', evidence_quality: 'weak' },
    { finding: 's', evidence_quality: 'strong' },
    { finding: 'u' },
    { finding: 'a', evidence_quality: 'adequate' },
  ]);
  assert.deepEqual(out.map(f => f.finding), ['s', 'a', 'w', 'u']);
});

test('rankFindings does not mutate input and handles empty', () => {
  const input = [{ finding: 'x', evidence_quality: 'weak' }];
  rankFindings(input);
  assert.equal(input[0].finding, 'x');
  assert.deepEqual(rankFindings(null), []);
  assert.deepEqual(rankFindings(undefined), []);
});

test('salvagePhase: null/undefined -> {skipped:true}, then passes assertPhaseOutput', () => {
  const s1 = salvagePhase(null, 'X');
  assert.deepEqual(s1, { skipped: true, partial: null });
  assert.doesNotThrow(() => assertPhaseOutput(s1, 'X'));
  const s2 = salvagePhase(undefined, 'X');
  assert.equal(s2.skipped, true);
});

test('salvagePhase: a real object passes through unchanged', () => {
  const obj = { ok: true, data: 1 };
  assert.equal(salvagePhase(obj, 'X'), obj);
});

test('assertPhaseOutput still throws on non-null non-object (salvage does not mask it)', () => {
  assert.throws(() => assertPhaseOutput('junk', 'X'));
  assert.throws(() => assertPhaseOutput(42, 'X'));
});
