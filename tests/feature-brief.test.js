// tests/feature-brief.test.js
// Guards that feature.src.js threads a.brief into every phase request.
// Regression: object-form invocation ({brief:...}) carries no a._ (positional),
// so deriving `request` from a._ ALONE silently dropped the brief and the
// researcher fell back to `bd ready`, working an unrelated bead. feature is the
// reference implementation; profile=small reuses these same phase prompts.
// (Replaces small-feature-brief.test.js after small-feature folded into
// /feature profile=small.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(ROOT, '..', 'src/workflows/feature.src.js'), 'utf8');

test('feature phase requests never derive from a._ without also adding a.brief', () => {
  assert.doesNotMatch(
    SRC,
    /request: \(a\._ \? a\._\.join\(' '\) : ''\)(?!\s*\+)/,
    'no phase request may derive from a._ without also adding a.brief',
  );
});

test('feature threads a.brief into multiple phase prompts (research/discover/impl)', () => {
  const briefUses = (SRC.match(/a\.brief \? ' ' \+ a\.brief/g) || []).length;
  assert.ok(briefUses >= 3, `expected >=3 phases to thread a.brief, found ${briefUses}`);
});
