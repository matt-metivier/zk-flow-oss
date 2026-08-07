// tests/doc-accuracy.test.js
// Validates that docs/architecture.md workflow catalog matches actual src/workflows/*.src.js files
// and that key referenced paths exist.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rubricNamesInUse } from '../build.js';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

test('docs/architecture.md: workflow catalog matches actual src/workflows/', () => {
  const arch = readFileSync(join(ROOT, 'docs/architecture.md'), 'utf8');
  const srcFiles = readdirSync(join(ROOT, 'src/workflows'))
    .filter(f => f.endsWith('.src.js') && !f.startsWith('_'))
    .map(f => f.replace('.src.js', ''));

  for (const name of srcFiles) {
    assert.ok(
      arch.includes(`\`${name}\``),
      `docs/architecture.md missing workflow in catalog: \`${name}\``
    );
  }
});

test('docs/workflows/: every workflow has a doc file', () => {
  const srcFiles = readdirSync(join(ROOT, 'src/workflows'))
    .filter(f => f.endsWith('.src.js') && !f.startsWith('_'))
    .map(f => f.replace('.src.js', ''));
  
  for (const name of srcFiles) {
    const docPath = join(ROOT, 'docs/workflows', `${name}.md`);
    assert.ok(existsSync(docPath), `Missing workflow doc: docs/workflows/${name}.md`);
  }
});

test('docs/workflows/: no doc files for non-existent workflows', () => {
  const srcFiles = new Set(
    readdirSync(join(ROOT, 'src/workflows'))
      .filter(f => f.endsWith('.src.js') && !f.startsWith('_'))
      .map(f => f.replace('.src.js', ''))
  );

  const docFiles = readdirSync(join(ROOT, 'docs/workflows'))
    .filter(f => f.endsWith('.md') && f !== 'README.md')
    .map(f => f.replace('.md', ''));

  for (const name of docFiles) {
    assert.ok(srcFiles.has(name), `Orphan doc (no workflow): docs/workflows/${name}.md`);
  }
});

test('all agents referenced in workflows exist as .claude/agents/*.md', () => {
  const agentFiles = new Set(
    readdirSync(join(ROOT, '.claude/agents'))
      .filter(f => f.endsWith('.md'))
      .map(f => f.replace('.md', ''))
  );

  const srcDir = join(ROOT, 'src/workflows');
  const files = readdirSync(srcDir).filter(f => f.endsWith('.src.js'));
  
  for (const file of files) {
    const content = readFileSync(join(srcDir, file), 'utf8');
    const matches = [...content.matchAll(/agentType:\s*'([^']+)'/g)];
    for (const [, agentType] of matches) {
      // Skip dynamic agentTypes (variables like p, agentType)
      if (agentType.includes('${') || agentType === agentType.toUpperCase()) continue;
      assert.ok(
        agentFiles.has(agentType),
        `${file} references agentType:'${agentType}' but .claude/agents/${agentType}.md not found`
      );
    }
  }
});

test('all rubrics referenced by build.js exist', () => {
  // Was: regex-scrape the `const rubrics = [...]` literal out of build.js. That broke the
  // moment the list stopped being a literal, and it never covered the phase names the
  // workflows actually resolve — which is how feature's phaseName:'impl' and 'simplify'
  // ended up pointing the grader at files that did not exist. Use the real resolver.
  const baseline = ['research','design','implementation','review','testing','proposal',
    'discover','investigate','refactor','self-improvement','validation-contract'];
  const required = [...new Set([...baseline, ...rubricNamesInUse()])];
  for (const r of required) {
    assert.ok(existsSync(join(ROOT, 'prompts', 'rubrics', `${r}-rubric.md`)),
      `phase '${r}' resolves to prompts/rubrics/${r}-rubric.md, which is missing — the grader would be told to read a nonexistent file`);
  }
  assert.ok(required.includes('simplify'), 'simplify is resolved by a runPhase call and must be covered');
  assert.ok(!required.includes('impl'), "'impl' must not be used as a phase name — the rubric is implementation-rubric.md");
});

test('docs/workflows/README.md has a linked bullet for every workflow', () => {
  // My first version of this check grepped for the bare name and passed while
  // `investigate` had no entry at all — the word appears inside another bullet's prose.
  // Require the bullet form.
  const readme = readFileSync(join(ROOT, 'docs/workflows/README.md'), 'utf8');
  const names = readdirSync(join(ROOT, 'src/workflows'))
    .filter(f => f.endsWith('.src.js') && !f.startsWith('_'))
    .map(f => f.replace('.src.js', ''));
  const missing = names.filter(n => !readme.includes(`- [${n}](./${n}.md)`));
  assert.deepEqual(missing, [], `workflows with no bullet in docs/workflows/README.md: ${missing}`);
  // and the stated count must match reality
  const claimed = readme.match(/The (\d+) workflows fall into/);
  assert.ok(claimed, 'README states a workflow count');
  assert.equal(Number(claimed[1]), names.length, 'stated workflow count matches src/workflows/');
});

test('CONTEXT.md glossary covers the concepts grill cross-references', () => {
  // grill/devils-advocate challenge claims against this glossary; a concept absent from it
  // cannot be challenged.
  const ctx = readFileSync(join(ROOT, 'CONTEXT.md'), 'utf8');
  for (const term of ['skill drift', 'sync marker', 'gap evidence', 'untrusted-data fence',
                      'scope gate', 'native skill discovery']) {
    assert.ok(ctx.toLowerCase().includes(term.toLowerCase()), `glossary missing: ${term}`);
  }
});
