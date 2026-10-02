// tests/feature-autoapprove.test.js
// Guards the autoApprove wiring: the design->impl handoff boundary must stop for
// human approval by DEFAULT, but when autoApprove=true the RUN 1 design block must
// NOT return — it falls through into RUN 2 (impl) in the same invocation. The
// autoApprove control key was previously parsed (args.js) but never consumed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildWorkflow, fragmentsFor } from '../build.js';

const ROOT = dirname(fileURLToPath(import.meta.url));
const REPO = join(ROOT, '..');
const SRC = readFileSync(join(REPO, 'src/workflows/feature.src.js'), 'utf8');

test('feature builds and parses with the autoApprove wiring', () => {
  const out = buildWorkflow('feature', fragmentsFor('feature'));
  assert.doesNotThrow(() => {
    const stripped = out.replace(/^export\s+/gm, '');
    // eslint-disable-next-line no-new-func
    new Function('return (async () => { ' + stripped + ' })');
  });
});

test('handoff return is guarded by autoApprove (default still stops for human)', () => {
  // the design_complete return must sit inside an `if (!(a.autoApprove ...))` block
  assert.match(SRC, /if \(!\(a\.autoApprove === true \|\| a\.autoApprove === 'true'\)\)/,
    'handoff boundary must be guarded by an autoApprove check');
  assert.match(SRC, /verdict: 'design_complete'/, 'default path must still return design_complete');
});

test('autoApprove falls through to impl (no return after the guarded handoff)', () => {
  const guardIdx = SRC.indexOf("a.autoApprove === true || a.autoApprove === 'true'");
  const implIdx = SRC.indexOf('implResult = await runPhase(');
  assert.ok(guardIdx !== -1, 'autoApprove guard must exist');
  assert.ok(implIdx !== -1, 'impl runPhase must exist');
  assert.ok(guardIdx < implIdx, 'guard precedes impl so autoApprove can fall through into RUN 2');
  // the fall-through must be announced, not silently returned
  assert.match(SRC, /autoApprove=true — chaining approved design directly into impl/,
    'autoApprove fall-through must log its intent');
});

test('feature discover uses relevance-gated catalog prefilter', () => {
  assert.match(SRC, /buildDiscoverCatalogCommand\(/, 'discover should build a filtered catalog command');
  assert.match(SRC, /If the filtered catalog clearly lacks needed coverage/, 'prompt should allow correctness fallback');
  assert.doesNotMatch(SRC, /1\. Skill catalog: run 'cat \"\$ZK_ARTIFACTS_DIR\/skills\/CATALOG\.md\"'/, 'discover should not ask for the full catalog first');
});
