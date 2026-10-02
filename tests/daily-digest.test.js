// tests/daily-digest.test.js
// Schema shape + remember workflow build validity for the daily-digest handoff.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildWorkflow, fragmentsFor } from '../build.js';

const ROOT = dirname(fileURLToPath(import.meta.url));
const REPO = join(ROOT, '..');

test('daily-digest.json is valid draft-07 and requires the 6 fields', () => {
  const s = JSON.parse(readFileSync(join(REPO, 'schemas/daily-digest.json'), 'utf8'));
  assert.equal(s.type, 'object');
  assert.deepEqual(
    [...s.required].sort(),
    ['beads_touched', 'commits', 'date', 'host', 'open_loops', 'threads'],
  );
  // open_loops items are {id,title}
  assert.deepEqual([...s.properties.open_loops.items.required].sort(), ['id', 'title']);
  // threads items are {cwd,beads}
  assert.deepEqual([...s.properties.threads.items.required].sort(), ['beads', 'cwd']);
});

test('schema auto-globs into the remember bundle SCHEMAS literal', () => {
  const bundle = buildWorkflow('remember', fragmentsFor('remember'));
  assert.ok(bundle.includes('"daily-digest"'), 'daily-digest schema must be inlined via build.js glob');
});

test('remember workflow builds self-contained (no imports, only known fragments)', () => {
  const bundle = buildWorkflow('remember', fragmentsFor('remember'));
  assert.ok(bundle.includes('export const meta'), 'has meta');
  assert.ok(!bundle.includes('// @@FRAGMENTS@@'), 'no leftover marker');
  assert.ok(!/^import\s/m.test(bundle), 'no import lines');
  // parse check
  const stripped = bundle.replace(/^export\s+/gm, '');
  assert.doesNotThrow(() => new Function('return (async () => { ' + stripped + ' })'));
});

test('remember bundle uses no sandbox-banned globals (Date/process/Math.random)', () => {
  const src = readFileSync(join(REPO, 'src/workflows/remember.src.js'), 'utf8');
  assert.ok(!/\bnew Date\b/.test(src), 'no new Date()');
  assert.ok(!/\bDate\.now\b/.test(src), 'no Date.now()');
  assert.ok(!/\bprocess\./.test(src), 'no process.*');
  assert.ok(!/\bMath\.random\b/.test(src), 'no Math.random()');
});
