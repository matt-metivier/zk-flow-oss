// tests/scope-leak.test.js
// Guards against the PR#3 / f4af667 bug class: a `const`/`let` declared inside a
// block (if/for/branch) but referenced in an outer or sibling scope. Such a
// reference throws ReferenceError at runtime — and `new Function`/parse checks
// do NOT catch it (the code parses fine; the name is simply unbound at runtime).
//
// The analyzer is brace-aware: it skips line/block comments, '..'/".." strings,
// and `..` template literals (descending into ${} expressions, which DO
// reference outer vars). For every reference to a name that is declared
// somewhere, it asserts a declaration is visible in the current or an ancestor
// scope and appears before the use. If the only declaration sits in a
// non-ancestor scope, that is a scope-leak.
//
// A self-validation test runs the analyzer against a known-buggy snippet so this
// test can never silently pass by doing nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = dirname(fileURLToPath(import.meta.url));
const DIR = join(ROOT, '..', 'src', 'workflows');

function analyze(src) {
  let i = 0; const n = src.length;
  const scopeStack = [0];
  let nextScope = 1;
  const code = [];

  while (i < n) {
    const c = src[i], c2 = src[i + 1];
    if (c === '/' && c2 === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && c2 === '*') { i += 2; while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++; i += 2; continue; }
    if (c === '"' || c === "'") { const q = c; i++; while (i < n && src[i] !== q) { if (src[i] === '\\') i++; i++; } i++; continue; }
    if (c === '`') {
      i++;
      while (i < n) {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === '`') { i++; break; }
        if (src[i] === '$' && src[i + 1] === '{') {
          i += 2; let bd = 1;
          while (i < n && bd > 0) {
            const e = src[i], e2 = src[i + 1];
            if (e === '/' && e2 === '/') { while (i < n && src[i] !== '\n') i++; continue; }
            if (e === '"' || e === "'") { const q = e; i++; while (i < n && src[i] !== q) { if (src[i] === '\\') i++; i++; } i++; continue; }
            if (e === '`') { i++; let td = 1; while (i < n && td > 0) { if (src[i] === '\\') { i += 2; continue; } if (src[i] === '`') td--; i++; } continue; }
            if (e === '{') bd++;
            else if (e === '}') bd--;
            else code.push({ ch: e, sp: scopeStack.slice() });
            i++;
          }
          continue;
        }
        i++;
      }
      continue;
    }
    if (c === '{') { scopeStack.push(nextScope++); code.push({ ch: c, sp: scopeStack.slice() }); i++; continue; }
    if (c === '}') { code.push({ ch: c, sp: scopeStack.slice() }); scopeStack.pop(); i++; continue; }
    code.push({ ch: c, sp: scopeStack.slice() });
    i++;
  }

  const clean = code.map(x => x.ch).join('');
  const paths = code.map(x => x.sp);

  const decls = [];
  let m;
  const declRe = /\b(const|let|var)\s+([A-Za-z_$][\w$]*)/g;
  while ((m = declRe.exec(clean))) {
    const sp = paths[m.index] || [0];
    decls.push({ name: m[2], scopePath: sp, idx: m.index });
  }
  const listRe = /\b(const|let|var)\s+([A-Za-z_$][\w$,\s=]*?);/g;
  while ((m = listRe.exec(clean))) {
    const sp = paths[m.index] || [0];
    m[2].split(',').forEach(part => {
      const nm = part.trim().split('=')[0].trim();
      if (/^[A-Za-z_$][\w$]*$/.test(nm) && !decls.some(d => d.name === nm && d.idx === m.index)) {
        decls.push({ name: nm, scopePath: sp, idx: m.index });
      }
    });
  }

  const declNames = new Set(decls.map(d => d.name));
  const findings = [];
  const useRe = /([.]?)\b([A-Za-z_$][\w$]*)\b(\s*:)?/g;
  while ((m = useRe.exec(clean))) {
    if (m[1] === '.') continue;   // property access, not a var ref
    if (m[3]) continue;           // object key / label `name:`
    const name = m[2];
    if (!declNames.has(name)) continue;
    const sp = paths[m.index] || [0];
    const ds = decls.filter(d => d.name === name);
    const visible = ds.some(d => d.idx < m.index && d.scopePath.every((s, k) => sp[k] === s));
    if (!visible && ds.length > 0) {
      findings.push({ name, snippet: clean.slice(Math.max(0, m.index - 30), m.index + 20).replace(/\s+/g, ' ') });
    }
  }
  return findings;
}

test('analyzer self-validation: catches a known scope-leak (not vacuous)', () => {
  const buggy = [
    "export const meta = { name: 'b' };",
    "let research;",
    "if (a.s === 'd') {",
    "  const skillsBlock = await r(x);",
    "  research = { out: 1 };",
    "}",
    "const out = doImpl(skillsBlock, research);", // skillsBlock leaks out of the if-block
  ].join('\n');
  const findings = analyze(buggy);
  assert.ok(findings.some(f => f.name === 'skillsBlock'),
    `expected a skillsBlock scope-leak finding, got: ${JSON.stringify(findings)}`);
});

test('no scope-leak across all src workflows', () => {
  const files = readdirSync(DIR).filter(f => f.endsWith('.src.js') && !f.startsWith('_'));
  assert.ok(files.length > 0, 'expected at least one src workflow');
  const failures = [];
  for (const f of files) {
    const findings = analyze(readFileSync(join(DIR, f), 'utf8'));
    for (const fi of findings) failures.push(`${f}: '${fi.name}' referenced out of scope — ...${fi.snippet}...`);
  }
  assert.deepEqual(failures, [], `Scope-leak findings:\n${failures.join('\n')}`);
});
