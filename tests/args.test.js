// tests/args.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs, readArgs } from '../src/fragments/args.js';

test('parses key=value pairs', () => {
  assert.deepEqual(parseArgs('depth=full mode=interview'), { depth: 'full', mode: 'interview' });
});
test('bare tokens collect into _ (positional)', () => {
  assert.deepEqual(parseArgs('fix the bug depth=light'), { _: ['fix','the','bug'], depth: 'light' });
});
test('empty / undefined -> {}', () => {
  assert.deepEqual(parseArgs(''), {});
  assert.deepEqual(parseArgs(undefined), {});
});
test('readArgs passes objects through, parses strings', () => {
  assert.deepEqual(readArgs({ depth: 'full' }), { depth: 'full' });
  assert.deepEqual(readArgs('depth=full'), { depth: 'full' });
  assert.deepEqual(readArgs(undefined), {});
});
test('non-control key=value stays positional', () => {
  assert.deepEqual(parseArgs('fix the timeout=30 bug depth=full'),
    { _: ['fix','the','timeout=30','bug'], depth: 'full' });
});
