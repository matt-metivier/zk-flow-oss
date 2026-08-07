// tests/context-pack.test.js
// The three durable signals — machine persona, prior beads, vault Map of Contents — all
// rode the discover phase, and 13 of 18 workflows do not have one. Measured before the
// fix: persona reached 4 workflows, MoC reached the discover prompt only, and
// bdBoundedContext was called from nowhere outside bd-memory.js itself.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildWorkflow, fragmentsFor } from '../build.js';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SRC = readFileSync(join(ROOT, 'src/fragments/context-pack.js'), 'utf8');
const mod = await import('data:text/javascript,' + encodeURIComponent(
  SRC.replace(/^import \{ bdBoundedContext \} from '\.\/bd-memory\.js';$/m,
              "const bdBoundedContext = (k) => `bd search ${k}`;")));

// Workflows with no discover phase that do domain work — they get the pack.
const PACKED = ['debug', 'test', 'investigate', 'review', 'critique', 'grill',
                'simplify', 'dashboard', 'finish-pr'];
// Workflows with a discover phase — they already resolve persona and now use the
// bounded bead retrieval instead of an ad-hoc `bd list | grep`.
const DISCOVER = ['feature', 'design', 'research', 'refactor'];
// Deliberate exclusions, with the reason recorded so they cannot rot into oversights.
const NO_PACK = {
  update: 'resolves its own persona + sources; a second persona read would be duplicate cost',
  remember: 'reads DailyDigest beads directly — that IS the durable context',
  'vault-sync': 'Scope phase already resolves host, persona-derived note_dir and prior marker',
  improve: 'operates ON the skills/rubrics and already clusters bead feedback',
  'eval-tool': 'evaluates external repos; machine persona is irrelevant to a third-party tool',
};

test('every packed workflow computes AND injects the context block', () => {
  for (const name of PACKED) {
    const out = buildWorkflow(name, fragmentsFor(name));
    assert.ok(/function contextPack/.test(out), `${name}: fragment inlined`);
    assert.ok(/const ctxBlock = await contextPack\(/.test(out), `${name}: computed`);
    // Computing it and not injecting it is the exact bug that hid the skills gap for months.
    assert.ok(/\$\{ctxBlock\}|context: ctxBlock|skillsBlock \+ ctxBlock/.test(out),
      `${name}: ctxBlock is injected into a prompt, not computed and dropped`);
  }
});

test('discover-phase workflows use bounded bead retrieval, not an ad-hoc grep', () => {
  for (const name of DISCOVER) {
    const out = buildWorkflow(name, fragmentsFor(name));
    assert.ok(/function bdBoundedContext/.test(out), `${name}: helper inlined`);
    assert.ok(/bdBoundedContext\(/.test(out), `${name}: helper actually called`);
    assert.ok(!/bd list --json 2>\/dev\/null \| jq -r/.test(out),
      `${name}: the ad-hoc bead grep is gone`);
  }
});

test('deliberate exclusions stay excluded, with reasons', () => {
  for (const [name, reason] of Object.entries(NO_PACK)) {
    const out = buildWorkflow(name, fragmentsFor(name));
    assert.ok(!/const ctxBlock = await contextPack\(/.test(out), `${name} should not pack: ${reason}`);
  }
});

test('every section is budget-clamped and the cut is marked', () => {
  const { clampSection, CONTEXT_BUDGETS } = mod;
  const long = 'x'.repeat(5000);
  for (const key of ['persona', 'beads', 'moc']) {
    const out = clampSection(long, CONTEXT_BUDGETS[key]);
    assert.ok(out.length <= CONTEXT_BUDGETS[key] + 30, `${key} clamped to its budget`);
    assert.match(out, /truncated to budget/, `${key} says it was cut`);
  }
  assert.equal(clampSection('short', 100), 'short', 'under-budget text is untouched');
  assert.equal(clampSection(null, 100), '', 'null is safe');
});

test('the formatted block cannot exceed the total budget by much', () => {
  const { formatContextPack, CONTEXT_BUDGETS } = mod;
  const block = formatContextPack({
    persona: 'p'.repeat(9000), beads: 'b'.repeat(9000), moc: 'm'.repeat(9000),
    host: 'n', moc_consulted: 'KB.md',
  });
  // headings + the precedent warning add fixed overhead; the point is that it is bounded.
  assert.ok(block.length < CONTEXT_BUDGETS.total + 800,
    `block is ${block.length} chars, budget ${CONTEXT_BUDGETS.total} + headings`);
});

test('an empty pack produces no block at all (no empty headings)', () => {
  const { formatContextPack } = mod;
  assert.equal(formatContextPack({ persona: '', beads: '', moc: '' }), '');
  assert.equal(formatContextPack(null), '');
});

test('prior beads are framed as precedent to check, not as fact', () => {
  const { formatContextPack } = mod;
  const block = formatContextPack({ persona: '', beads: 'zk-flow-123 fixed X', moc: '' });
  assert.match(block, /precedent to check, not as fact/,
    'a prior run can have been wrong — say so where it is injected');
});

test('contextPack never throws (additive context must not break a working run)', () => {
  const fn = SRC.slice(SRC.indexOf('export async function contextPack'));
  assert.match(fn, /catch \(e\)/, 'has a catch');
  assert.ok(!/throw /.test(fn), 'does not rethrow');
  assert.match(fn, /return ''/, 'degrades to an empty block');
});

test('the prompt tells the agent to prefer empty over speculative', () => {
  // Every line returned is injected downstream and read as established fact.
  assert.match(SRC, /Prefer empty over speculative/);
  assert.match(SRC, /an unrelated bead is worse than none/);
});
