// build.js
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = dirname(fileURLToPath(import.meta.url));
const stripExports = (src) => src.replace(/^export\s+/gm, '');
// Strip single-named relative fragment imports so bundles stay import-free.
// ONLY this shape is supported: `import { name } from './frag.js';`
// Default / namespace / multi-line / double-quoted / extensionless imports
// survive and trip build-validity.test.js (/^import\s/m) — by design. The lone
// case is model-tiers.js importing operating-posture so tests can load it as
// real ESM; at runtime operatingInstructions resolves from shared bundle scope.
const stripFragmentImports = (src) =>
  src.replace(/^import\s+\{[^}]*\}\s+from\s+'\.\/[\w-]+\.js';?\s*$/gm, '');

// Special-case: schemas fragment is emitted as an inlined literal (workflows can't import JSON).
function schemasLiteral() {
  // Glob every schema so new files can't be silently absent from SCHEMAS.
  const names = readdirSync(join(ROOT, 'schemas')).filter(f => f.endsWith('.json')).map(f => f.slice(0, -5));
  const obj = Object.fromEntries(names.map(n =>
    [n, JSON.parse(readFileSync(join(ROOT, 'schemas', `${n}.json`), 'utf8'))]));
  return `const SCHEMAS = ${JSON.stringify(obj)};`;
}

// Phase prompts fragment — inlines prompts/phases/*.md as string constants.
// Fails build if a required phase prompt is missing (fail-fast at build time).
function phasePromptsLiteral() {
  const phases = ['research','design','implementation','testing','discover','self-improvement','ci','review','investigate','claim-vote','validation-contract'];
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
// The list is the union of a known baseline and every phase name the workflows actually
// resolve at runtime. runPhase builds rubricPath from `phaseName || label.split(':')[0]`
// and tells the grader to read that file, so a name with no rubric means the grader is
// handed a dangling path and scores with no criteria. The hardcoded list alone missed
// feature's phaseName:'impl' and phaseName:'simplify' for exactly that reason.
export function rubricNamesInUse() {
  const names = new Set();
  const dir = join(ROOT, 'src/workflows');
  for (const f of readdirSync(dir).filter(x => x.endsWith('.src.js') && !x.startsWith('_'))) {
    const body = readFileSync(join(dir, f), 'utf8');
    // Resolve per call site the way runPhase does: phaseName when given, else the
    // label's first segment. Scanning the two patterns independently would demand
    // rubrics for labels that phaseName already overrides (e.g. label 'rootcause'
    // with phaseName 'research').
    for (const m of body.matchAll(/runPhase\(\{/g)) {
      const chunk = body.slice(m.index, m.index + 1200);
      const pn = chunk.match(/phaseName:\s*'([^']+)'/);
      const label = chunk.match(/label:\s*'([^']+)'/);
      const resolved = pn ? pn[1] : (label ? label[1].split(':')[0].split('-grade')[0] : null);
      if (resolved) names.add(resolved);
    }
  }
  return names;
}

function assertRubricsExist() {
  const baseline = ['research','design','implementation','review','testing','proposal','discover','investigate','refactor','self-improvement','validation-contract'];
  const rubrics = [...new Set([...baseline, ...rubricNamesInUse()])];
  for (const r of rubrics) {
    const fpath = join(ROOT, 'prompts', 'rubrics', `${r}-rubric.md`);
    try { readFileSync(fpath, 'utf8'); } catch (e) {
      throw new Error(`Missing rubric: prompts/rubrics/${r}-rubric.md — a workflow resolves this phase name, so the grader would be told to read a file that does not exist and would score with no criteria.`);
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

// Fail-fast: bundle must define every fragment function it references.
// Catches @@USE lists that omit a transitive dependency (e.g. run-phase -> bdWrite).
function assertBundleSelfContained(name, bundle) {
  const known = ['bdWrite', 'bdShow', 'loadPhasePrompt', 'assertPhaseOutput', 'assertFindings',
    'assertEvidencePresent', 'assertEvidenceQuality', 'assertDiscoverValid', 'assertTargetFiles',
    'modelFor', 'postureFor', 'renderSkills', 'selectAndRenderSkills',
    'buildDiscoverCatalogCommand', 'runPhase', 'handoffPrompt', 'runBeadId',
    'persistPhase', 'persistSolution', 'requireZkArtifacts', 'buildPersonaSection', 'readArgs',
    'pauseForOperator', 'shouldPauseBefore',
    'routeVerdict', 'criteriaForDepth', 'validPerspectives', 'nextTier',
    'workspaceBranch', 'workspaceBootstrap', 'buildProofOfWork', 'operatingInstructions',
    'runWithBacktrack', 'verifyClaims', 'claimSurvives', 'rankFindings', 'salvagePhase',
    'persistPhaseSoft', 'routeFindingsToBead', 'routePhase', 'and_', 'or_',
    'UNTRUSTED', 'kebab', 'syncPreflight', 'vaultSyncSuggestions',
    'assertSelectedSkillsValid', 'warnIfSkillsDropped', 'scopeViolations',
    'contextPack', 'formatContextPack', 'clampSection', 'bdBoundedContext'];
  for (const fn of known) {
    const called = new RegExp('\\b' + fn + '\\s*\\(').test(bundle);
    const defined = new RegExp('function ' + fn + '\\b|const ' + fn + '\\s*=').test(bundle);
    if (called && !defined) throw new Error(`${name}: bundle calls ${fn}() but no fragment in @@USE defines it`);
  }
}

// meta.phases must match the phase() calls. A declared-but-never-called phase shows an
// inert group in the progress UI; a called-but-undeclared one shows work with no heading.
// feature ('Impl'), investigate ('Hypotheses') and remember ('Resume') had all drifted.
function assertPhasesDeclared(name, body) {
  const declared = new Set([...body.matchAll(/title:\s*'([^']+)'/g)].map(m => m[1]));
  const called = new Set([...body.matchAll(/\bphase\('([^']+)'\)/g)].map(m => m[1]));
  const notCalled = [...declared].filter(p => !called.has(p));
  const notDeclared = [...called].filter(p => !declared.has(p));
  if (notCalled.length) throw new Error(`${name}: meta.phases declares [${notCalled}] but never calls phase() for them — either open the phase or drop it from meta`);
  if (notDeclared.length) throw new Error(`${name}: calls phase() for [${notDeclared}] which meta.phases does not declare`);
}

// Workflow-local vars must be declared before first use (TDZ killed /research,
// /small-feature, /design at runtime; /refactor referenced vars that never existed).
// Checked on the workflow SOURCE (fragments have their own scopes/params).
function assertDeclarationOrder(name, body) {
  for (const v of ['discovery', 'skillsBlock']) {
    const usage = body.search(new RegExp('\\b' + v + '\\b'));
    if (usage === -1) continue;
    const decl = body.search(new RegExp('(let|const)\\s+' + v + '\\b'));
    if (decl === -1) throw new Error(`${name}: '${v}' is used but never declared`);
    if (decl > usage) throw new Error(`${name}: '${v}' is used before its declaration (TDZ crash at runtime) — declare 'let ${v}' before first use`);
  }
}

export function buildWorkflow(name, fragments) {
  const body = readFileSync(join(ROOT, 'src/workflows', `${name}.src.js`), 'utf8');
  assertDeclarationOrder(name, body);
  assertPhasesDeclared(name, body);
  const inlined = fragments.map(f =>
    f === 'schemas' ? schemasLiteral()
      : f === 'prompt-loader'
        // PHASE_PROMPTS data literal + the loadPhasePrompt/assertPhaseExists functions —
        // emitting only the literal left loadPhasePrompt undefined at runtime.
        ? phasePromptsLiteral() + '\n\n' + stripExports(readFileSync(join(ROOT, 'src/fragments', 'prompt-loader.js'), 'utf8'))
      : stripFragmentImports(stripExports(readFileSync(join(ROOT, 'src/fragments', `${f}.js`), 'utf8')))
  ).join('\n\n');
  if (!body.includes('// @@FRAGMENTS@@')) throw new Error(`${name}: missing // @@FRAGMENTS@@ marker`);
  const bundle = body.replace('// @@FRAGMENTS@@', inlined);
  assertBundleSelfContained(name, bundle);
  return bundle;
}

// Parse the @@USE: fragment list for a named workflow (skips _-prefixed).
export function fragmentsFor(name) {
  const src = readFileSync(join(ROOT, 'src/workflows', `${name}.src.js`), 'utf8');
  const useMatch = src.match(/\/\/ @@USE: (.+)/);
  return useMatch ? useMatch[1].split(',').map(s => s.trim()) : [];
}

// CLI: build every src/workflows/*.src.js that isn't _-prefixed
// Alias commands share their twin's bundle. Previously these existed only as
// stale orphan files in .claude/workflows/ carrying every pre-fix bug.
export const ALIASES = {
  'testing': 'test',
  'design-panel': 'critique',
  'review-council': 'review',
};

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
  // Regenerate alias bundles from their twins (stale orphans carried old bugs).
  for (const [alias, src] of Object.entries(ALIASES)) {
    const out = buildWorkflow(src, fragmentsFor(src));
    writeFileSync(join(ROOT, '.claude/workflows', `${alias}.js`), out);
    console.log(`built: .claude/workflows/${alias}.js (alias of ${src})`);
  }
}
