// tests/build-validity.test.js
// Verifies that every src/workflows/*.src.js (non-_-prefixed) builds to a valid
// self-contained workflow: contains `export const meta`, has no leftover
// // @@FRAGMENTS@@ marker, has no import lines, and parses without throwing.
// This replaces build-drift.test.js — .claude/workflows/*.js are now generated
// (gitignored) and not committed, so drift comparison is moot.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildWorkflow, fragmentsFor } from '../build.js';

const ROOT = dirname(fileURLToPath(import.meta.url));
const REPO = join(ROOT, '..');

test('every src workflow builds to a valid self-contained output', () => {
  const srcFiles = readdirSync(join(REPO, 'src/workflows'))
    .filter(f => f.endsWith('.src.js') && !f.startsWith('_'));

  assert.ok(srcFiles.length > 0, 'expected at least one src workflow');

  const failures = [];
  for (const file of srcFiles) {
    const name = file.replace('.src.js', '');
    let out;
    try {
      out = buildWorkflow(name, fragmentsFor(name));
    } catch (e) {
      failures.push(`${name}: buildWorkflow threw: ${e.message}`);
      continue;
    }

    // (a) must contain export const meta
    if (!out.includes('export const meta')) {
      failures.push(`${name}: missing 'export const meta'`);
    }
    // (b) must have no leftover @@FRAGMENTS@@ marker
    if (out.includes('// @@FRAGMENTS@@')) {
      failures.push(`${name}: leftover // @@FRAGMENTS@@ marker`);
    }
    // (c) must have no import lines (workflow sandbox has no import support)
    if (/^import\s/m.test(out)) {
      failures.push(`${name}: contains import line (fragments must not import)`);
    }
    // (d) must parse (strip leading 'export' keywords, wrap in async fn, new Function)
    try {
      const stripped = out.replace(/^export\s+/gm, '');
      // eslint-disable-next-line no-new-func
      new Function('return (async () => { ' + stripped + ' })');
    } catch (e) {
      failures.push(`${name}: parse error: ${e.message}`);
    }
  }

  assert.deepEqual(failures, [], `Build validity failures:\n${failures.join('\n')}`);
});
