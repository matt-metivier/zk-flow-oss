// tests/doc-accuracy.test.js
// Validates that docs/architecture.md workflow catalog matches actual src/workflows/*.src.js files
// and that key referenced paths exist.

import { test } from 'node:test';
import assert from 'node:assert/strict';
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
  const buildJs = readFileSync(join(ROOT, 'build.js'), 'utf8');
  const rubricsMatch = buildJs.match(/const rubrics = \[([^\]]+)\]/);
  if (!rubricsMatch) return;
  const rubrics = rubricsMatch[1].split(',').map(r => r.trim().replace(/'/g, ''));
  for (const r of rubrics) {
    const p = join(ROOT, 'prompts/rubrics', `${r}-rubric.md`);
    assert.ok(existsSync(p), `Rubric listed in build.js but missing: prompts/rubrics/${r}-rubric.md`);
  }
});
