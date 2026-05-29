// build.js
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = dirname(fileURLToPath(import.meta.url));
const stripExports = (src) => src.replace(/^export\s+/gm, '');

// Special-case: schemas fragment is emitted as an inlined literal (workflows can't import JSON).
function schemasLiteral() {
  const names = ['research','design','implementation','review','testing','discover','proposal','solution'];
  const obj = Object.fromEntries(names.map(n =>
    [n, JSON.parse(readFileSync(join(ROOT, 'schemas', `${n}.json`), 'utf8'))]));
  return `const SCHEMAS = ${JSON.stringify(obj)};`;
}

export function buildWorkflow(name, fragments) {
  const body = readFileSync(join(ROOT, 'src/workflows', `${name}.src.js`), 'utf8');
  const inlined = fragments.map(f =>
    f === 'schemas' ? schemasLiteral()
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
