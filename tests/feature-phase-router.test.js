// tests/feature-phase-router.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = dirname(fileURLToPath(import.meta.url));
const REPO = join(ROOT, '..');
const SRC = readFileSync(join(REPO, 'src/workflows/feature.src.js'), 'utf8');

test('feature workflow declares the phase-router fragment', () => {
  assert.match(SRC, /@@USE: .*\bphase-router\b/, 'feature @@USE must include phase-router');
});

test('feature routes only the three homogeneous runPhase boundary guards', () => {
  for (const phase of ['research', 'impl', 'testing']) {
    assert.match(SRC, new RegExp(`phase: '${phase}'`), `${phase} route must remain represented`);
  }

  assert.doesNotMatch(
    SRC,
    /if \(!research\.ok\) \{[\s\S]*?return \{ verdict: 'needs_human', phase: 'research' \};[\s\S]*?\}/,
    'research runPhase boundary must be routed, not an inline homogeneous guard'
  );
  assert.doesNotMatch(
    SRC,
    /if \(!implResult\.ok\) \{[\s\S]*?return \{ verdict: 'needs_human', phase: 'impl' \};[\s\S]*?\}/,
    'impl runPhase boundary must be routed, not an inline homogeneous guard'
  );
  assert.doesNotMatch(
    SRC,
    /if \(!testing\.ok\) \{[\s\S]*?return \{ verdict: 'needs_human', phase: 'testing' \};[\s\S]*?\}/,
    'testing runPhase boundary must be routed, not an inline homogeneous guard'
  );
});

test('feature keeps heterogeneous guards inline', () => {
  assert.match(SRC, /if \(!loadedDesign\) \{[\s\S]*?could not load valid design from bead/, 'load-design guard is heterogeneous');
  assert.match(SRC, /if \(!ciResult\.passed\) return \{ verdict: 'needs_human', phase: ciResult\.phase \};/, 'CI guard is heterogeneous');
  assert.match(SRC, /if \(!implResult\.ok\) \{[\s\S]*?phase: 'review-fix'/, 'review-fix impl guard is heterogeneous');
  assert.match(SRC, /if \(reviewRoute !== 'done'\) \{[\s\S]*?phase: 'review'/, 'review route guard is heterogeneous');
});
