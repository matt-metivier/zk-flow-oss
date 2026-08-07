// tests/phase-router.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { and_, or_, routePhase } from '../src/fragments/phase-router.js';

const isResearch = (ret) => {
  if (!['research', 'impl', 'testing'].includes(ret.label)) {
    throw new Error(`unknown phase label: ${ret.label}`);
  }
  return ret.label === 'research';
};
const isImpl = (ret) => ret.label === 'impl';
const ok = (ret) => ret.ok === true;
const failed = (ret) => ret.ok !== true;

test('routePhase returns the first matching route', () => {
  const gates = [
    { when: and_(isResearch, failed), route: { verdict: 'needs_human', phase: 'research' } },
    { when: and_(isResearch, failed), route: { verdict: 'ignored', phase: 'second-match' } },
    { when: and_(isResearch, ok), route: { verdict: 'continue', phase: 'research' } },
  ];

  assert.deepEqual(
    routePhase(gates, { label: 'research', ok: false }),
    { verdict: 'needs_human', phase: 'research' }
  );
});

test('routePhase fails closed when no gate matches', () => {
  assert.deepEqual(
    routePhase([{ when: and_(isImpl, ok), route: { verdict: 'continue', phase: 'impl' } }], { label: 'testing', ok: true }),
    { verdict: 'needs_human', phase: 'unknown' }
  );
});

test('routePhase catches predicate errors and returns needs_human', () => {
  assert.deepEqual(
    routePhase([{ when: and_(isResearch, failed), route: { verdict: 'needs_human', phase: 'research' } }], { label: 'surprise', ok: false }),
    { verdict: 'needs_human', phase: 'unknown' }
  );
});

test('and_ and or_ compose predicates deterministically', () => {
  const ret = { label: 'impl', ok: false };

  assert.equal(and_(isImpl, failed)(ret), true);
  assert.equal(and_(isImpl, ok)(ret), false);
  assert.equal(or_(ok, failed)(ret), true);
});
