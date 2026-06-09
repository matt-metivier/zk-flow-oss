// build.js
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = dirname(fileURLToPath(import.meta.url));
const stripExports = (src) => src.replace(/^export\s+/gm, '');

// Special-case: schemas fragment is emitted as an inlined literal (workflows can't import JSON).
function schemasLiteral() {
  const names = ['research','design','implementation','review','testing','discover','investigate'];
  const obj = Object.fromEntries(names.map(n =>
    [n, JSON.parse(readFileSync(join(ROOT, 'schemas', `${n}.json`), 'utf8'))]));
  return `const SCHEMAS = ${JSON.stringify(obj)};`;
}

// Phase prompts fragment — inlines prompts/phases/*.md as string constants.
// Fails build if a required phase prompt is missing (fail-fast at build time).
function phasePromptsLiteral() {
  const phases = ['research','design','implementation','testing','discover','self-improvement','ci','review','investigate'];
  const obj = {};
  for (const p of phases) {
    const fpath = join(ROOT, 'prompts', 'phases', `${p}.md`);
    try {
      obj[p] = readFileSync(fpath, 'utf8');
    } catch (e) {
      throw new Error(`Missing phase prompt: prompts/phases/${p}.md — required for workflow injection.`);
    }
  }
  return `const PHASE_PROMPTS = ${JSON.stringify(obj)};`;
}

// Rubric existence check — fails build if any rubric file is missing.
function assertRubricsExist() {
  const rubrics = ['research','design','implementation','review','testing','proposal','discover','investigate','refactor','self-improvement'];
  for (const r of rubrics) {
    const fpath = join(ROOT, 'prompts', 'rubrics', `${r}-rubric.md`);
    try { readFileSync(fpath, 'utf8'); } catch (e) {
      throw new Error(`Missing rubric: prompts/rubrics/${r}-rubric.md — grader will silently fall back without it.`);
    }
  }
}

// Review perspective prompts existence check — fails build if any are missing.
function assertPerspectivePromptsExist() {
  const perspectives = ['advocate','critic','security','performance','learning','arbiter','persona','repo-conventions'];
  for (const p of perspectives) {
    const fpath = join(ROOT, 'prompts', 'review-perspective', `review-perspective-${p}.md`);
    try { readFileSync(fpath, 'utf8'); } catch (e) {
      throw new Error(`Missing review-perspective prompt: prompts/review-perspective/review-perspective-${p}.md`);
    }
  }
}

export function buildWorkflow(name, fragments) {
  const body = readFileSync(join(ROOT, 'src/workflows', `${name}.src.js`), 'utf8');
  const inlined = fragments.map(f =>
    f === 'schemas' ? schemasLiteral() : f === 'prompt-loader' ? phasePromptsLiteral()
      : stripExports(readFileSync(join(ROOT, 'src/fragments', `${f}.js`), 'utf8'))
  ).join('\n\n');
  if (!body.includes('// @@FRAGMENTS@@')) throw new Error(`${name}: missing // @@FRAGMENTS@@ marker`);
  return body.replace('// @@FRAGMENTS@@', inlined);
}

// Parse the @@USE: fragment list for a named workflow (skips _-prefixed).
export function fragmentsFor(name) {
  const src = readFileSync(join(ROOT, 'src/workflows', `${name}.src.js`), 'utf8');
  const useMatch = src.match(/\/\/ @@USE: (.+)/);
  return useMatch ? useMatch[1].split(',').map(s => s.trim()) : [];
}

// CLI: build every src/workflows/*.src.js that isn't _-prefixed
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  assertRubricsExist();
  assertPerspectivePromptsExist();
  mkdirSync(join(ROOT, '.claude/workflows'), { recursive: true });
  const files = readdirSync(join(ROOT, 'src/workflows'))
    .filter(f => f.endsWith('.src.js') && !f.startsWith('_'));
  for (const file of files) {
    const name = file.replace('.src.js', '');
    const out = buildWorkflow(name, fragmentsFor(name));
    writeFileSync(join(ROOT, '.claude/workflows', `${name}.js`), out);
    console.log(`built: .claude/workflows/${name}.js`);
  }
}
