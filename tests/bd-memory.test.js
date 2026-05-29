// tests/bd-memory.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bdWrite, bdShow, bdReady, assertId } from '../src/fragments/bd-memory.js';

test('bdWrite includes the <Type>: {json} body', () => {
  const snippet = bdWrite('abc-123', 'GraderFeedback', { passed: true });
  assert.ok(snippet.includes('GraderFeedback: {"passed":true}'), 'body must be in snippet');
});
test('bdWrite includes create-if-absent guard', () => {
  const snippet = bdWrite('abc-123', 'GraderFeedback', { passed: true });
  assert.ok(snippet.includes('bd show abc-123 >/dev/null 2>&1 || bd create --id abc-123 -t task >/dev/null 2>&1'), 'create-if-absent guard missing');
});
test('bdWrite includes bd comment with --stdin', () => {
  const snippet = bdWrite('abc-123', 'GraderFeedback', { passed: true });
  assert.ok(snippet.includes('bd comment abc-123 --stdin'), '--stdin missing');
});
test('bdShow / bdReady build read commands', () => {
  assert.equal(bdShow('abc-123'), 'bd show abc-123 --json');
  assert.equal(bdReady('self-improve'), 'bd ready --label self-improve');
  assert.equal(bdReady(), 'bd ready');
});
test('bead id is validated - rejects spaces, uppercase, and leading dash', () => {
  assert.throws(() => bdShow(''));
  assert.throws(() => bdShow('bad id'));
  assert.throws(() => bdShow('BadID'));
  assert.throws(() => bdShow('-x'), 'leading dash must be rejected');
  assert.throws(() => bdShow('--id'), 'leading dashes must be rejected');
});
test('bead id accepts dots, dashes, underscores', () => {
  assert.doesNotThrow(() => bdShow('my.bead-id_1'));
  assert.doesNotThrow(() => bdShow('zkflow-foo'));
  assert.doesNotThrow(() => bdShow('a.b_c'));
  assert.doesNotThrow(() => bdWrite('my.bead-id_1', 'T', {}));
});
