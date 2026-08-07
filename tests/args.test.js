// tests/args.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs, readArgs, discoverCatalogLimits, buildDiscoverCatalogCommand } from '../src/fragments/args.js';

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
test('JSON-stringified object yields control keys (startAt=impl resume path)', () => {
  const json = JSON.stringify({ startAt: 'impl', bead: 'abc-123' });
  assert.deepEqual(parseArgs(json), { startAt: 'impl', bead: 'abc-123' });
});
test('JSON-stringified object with mixed keys', () => {
  const json = JSON.stringify({ startAt: 'impl', bead: 'my.bead', skipReview: 'true', depth: 'full' });
  assert.deepEqual(parseArgs(json), { startAt: 'impl', bead: 'my.bead', skipReview: 'true', depth: 'full' });
});
test('pauseBefore is parsed as a control key', () => {
  assert.deepEqual(parseArgs('add a feature pauseBefore=impl'), { _: ['add','a','feature'], pauseBefore: 'impl' });
});
test('readArgs with JSON-stringified object string', () => {
  const json = JSON.stringify({ startAt: 'impl', bead: 'abc-123' });
  assert.deepEqual(readArgs(json), { startAt: 'impl', bead: 'abc-123' });
});
test('pauseBefore is parsed as a control argument', () => {
  assert.deepEqual(parseArgs('pauseBefore=impl autoApprove=true'), { pauseBefore: 'impl', autoApprove: 'true' });
});
test('malformed JSON falls through to space-separated parsing', () => {
  // Not valid JSON, so treated as space-separated
  assert.deepEqual(parseArgs('{notjson depth=full'), { _: ['{notjson'], depth: 'full' });
});

test('discover catalog filtering defaults to a safe topK with slack', () => {
  assert.deepEqual(discoverCatalogLimits({}), { topK: 5, slack: 2, candidateLimit: 7 });
});

test('discover catalog filtering rejects invalid topK and caps pathological values', () => {
  assert.deepEqual(discoverCatalogLimits({ topK: 'nope' }), { topK: 5, slack: 2, candidateLimit: 7 });
  assert.deepEqual(discoverCatalogLimits({ topK: '99' }), { topK: 10, slack: 2, candidateLimit: 12 });
});

test('discover catalog command filters before falling back to full catalog', () => {
  const cmd = buildDiscoverCatalogCommand({
    request: 'add oauth login',
    research: { key_findings: ['users need OIDC auth'] },
    topK: '3',
  });
  assert.match(cmd, /CATALOG_PREFILTER_CANDIDATES topK=3 limit=5/);
  assert.match(cmd, /PREFILTER_FALLBACK_FULL_CATALOG/);
  assert.match(cmd, /OIDC auth/);
});
