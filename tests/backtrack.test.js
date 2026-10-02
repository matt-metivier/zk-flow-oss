// tests/backtrack.test.js
// Unit tests for runWithBacktrack (backtrack-on-failure gate recovery, issue #41)
// + a build check that debug wires it in import-free.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runWithBacktrack } from '../src/fragments/backtrack.js';
import { buildWorkflow, fragmentsFor } from '../build.js';

const fail = (extra = {}) => ({ ok: false, out: 'x', grade: { findings: ['nope'] }, backtrackEligible: true, ...extra });
const pass = () => ({ ok: true, out: 'y', grade: null });

test('budget=0 is a pass-through: cur once, prev never', async () => {
  let cur = 0, prev = 0;
  const res = await runWithBacktrack(async () => { prev++; return pass(); }, async () => { cur++; return pass(); }, { budget: 0 });
  assert.equal(cur, 1);
  assert.equal(prev, 0);
  assert.equal(res.ok, true);
  assert.equal(res.backtracks, undefined, 'pass-through must not add fields');
});

test('absent/invalid budget coerces to 0 (off)', async () => {
  let prev = 0;
  await runWithBacktrack(async () => { prev++; return pass(); }, async () => fail(), {});
  assert.equal(prev, 0, 'no backtrack when budget unset');
});

test('budget=1, cur fails then succeeds after prev re-run', async () => {
  let cur = 0, prev = 0;
  const res = await runWithBacktrack(
    async () => { prev++; return pass(); },
    async () => { cur++; return cur === 1 ? fail() : pass(); },
    { budget: 1 }
  );
  assert.equal(prev, 1, 'prior phase re-run once');
  assert.equal(cur, 2, 'cur run twice (initial + after backtrack)');
  assert.equal(res.ok, true);
  assert.equal(res.backtracks, 1);
});

test('budget=1, cur always fails -> prev once, cur twice, returns failure', async () => {
  let cur = 0, prev = 0;
  const res = await runWithBacktrack(
    async () => { prev++; return pass(); },
    async () => { cur++; return fail(); },
    { budget: 1 }
  );
  assert.equal(prev, 1);
  assert.equal(cur, 2);
  assert.equal(res.ok, false, 'falls through to caller needs_human');
  assert.equal(res.backtracks, 1);
});

test('cur failure that is NOT backtrackEligible does not trigger backtrack', async () => {
  let prev = 0;
  const res = await runWithBacktrack(
    async () => { prev++; return pass(); },
    async () => ({ ok: false, grade: {}, backtrackEligible: false }),
    { budget: 3 }
  );
  assert.equal(prev, 0, 'no backtrack without the eligibility signal');
  assert.equal(res.ok, false);
});

test('prevRunner failure stops backtracking (does not mask it)', async () => {
  let cur = 0, prev = 0;
  const res = await runWithBacktrack(
    async () => { prev++; return { ok: false }; },   // prior phase itself fails
    async () => { cur++; return fail(); },
    { budget: 5 }
  );
  assert.equal(prev, 1);
  assert.equal(cur, 1, 'cur not retried once prev failed');
  assert.equal(res.ok, false);
});

test('debug builds with backtrack wired, import-free, default-off', () => {
  const out = buildWorkflow('debug', fragmentsFor('debug'));
  assert.doesNotMatch(out, /^import\s/m, 'bundle must be import-free');
  assert.match(out, /function runWithBacktrack\b/, 'backtrack fragment inlined');
  assert.match(out, /runWithBacktrack\(reRootCause, runFix, \{ budget: PHASE_BUDGETS\.backtrack/, 'debug wires fix via backtrack');
  assert.match(out, /backtrack: 0/, 'budget defaults to 0 (off)');
  assert.doesNotThrow(() => {
    const stripped = out.replace(/^export\s+/gm, '');
    // eslint-disable-next-line no-new-func
    new Function('return (async () => { ' + stripped + ' })');
  });
});

test('refactor builds with backtrack wired (refactor -> research), import-free, default-off', () => {
  const out = buildWorkflow('refactor', fragmentsFor('refactor'));
  assert.doesNotMatch(out, /^import\s/m, 'bundle must be import-free');
  assert.match(out, /function runWithBacktrack\b/, 'backtrack fragment inlined');
  assert.match(out, /runWithBacktrack\(reResearch, runRefactor, \{ budget: PHASE_BUDGETS\.backtrack/, 'refactor wires via backtrack');
});

test('backtrack standardization: code workflows wire it; feature wires it only for the no-seam small profile', () => {
  for (const w of ['debug', 'refactor']) {
    assert.match(buildWorkflow(w, fragmentsFor(w)), /runWithBacktrack\(/, `${w} must wire backtrack`);
  }
  // feature's default (full) profile still relies on its two-run human design-approval seam
  // instead of auto-backtrack. profile=small has no design phase and no seam (it replaced the
  // former /bugfix, which always backtracked impl->research) -- ported here, guarded so the
  // full-profile Impl call site is untouched.
  const out = buildWorkflow('feature', fragmentsFor('feature'));
  assert.match(out, /function runWithBacktrack\b/, 'backtrack fragment inlined');
  assert.match(out, /if \(profile === 'small'\) \{[\s\S]*?runWithBacktrack\(reResearch, runImpl, \{ budget: PHASE_BUDGETS\.backtrack/, 'feature wires impl->research backtrack, gated to profile=small');
});
