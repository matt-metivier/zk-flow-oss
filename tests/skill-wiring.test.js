// tests/skill-wiring.test.js
// Guards the two halves of skill wiring:
//   1. every workflow whose phase agents do domain work receives rendered skills
//      (the original bug: discover selected skills, downstream agents never got
//      them — and 13 workflows never selected any in the first place);
//   2. the flat-name derivation that makes the nested skills tree discoverable at
//      ~/.claude/skills/<name>/SKILL.md stays deterministic and collision-free.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, existsSync, statSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildWorkflow, fragmentsFor } from '../build.js';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

// Workflows whose agents write, review, debug, or operate something — they all need
// domain skills. Split by which mechanism applies.
const DISCOVER_WORKFLOWS = ['feature', 'design', 'research', 'refactor'];   // discover phase -> renderSkills
const SELECT_WORKFLOWS = ['debug', 'test', 'investigate', 'review', 'critique',
  'grill', 'simplify', 'dashboard', 'vault-sync'];                          // no discover -> selectAndRenderSkills
const BEAD_SKILL_WORKFLOWS = ['finish-pr'];                                 // loads research from a bead -> renderSkills

// Deliberate exclusions, with the reason. If one of these ever needs skills, move it
// into a list above rather than deleting this record.
const NO_SKILLS = {
  improve: 'operates ON the skill files themselves (reflector reads/mutates skills)',
  update: 'crawls chat sources and updates personas/memories, not code',
  remember: 'loads daily digest beads; no code or design work',
  'eval-tool': 'loads the tooling-eval skill explicitly by path — selection would be noise',
};

for (const name of [...DISCOVER_WORKFLOWS, ...SELECT_WORKFLOWS, ...BEAD_SKILL_WORKFLOWS]) {
  test(`${name}: rendered skills reach a phase agent prompt`, () => {
    const out = buildWorkflow(name, fragmentsFor(name));
    assert.ok(/function renderSkills/.test(out), 'skill-render fragment inlined');
    assert.ok(/skillsBlock/.test(out), 'skillsBlock referenced');
    // The block must be interpolated into a prompt, not just computed and dropped.
    assert.ok(/\$\{skillsBlock\}|skills: skillsBlock|skillsBlock \?|\+\n?\s*skillsBlock/.test(out),
      'skillsBlock is injected into a prompt');
  });
}

for (const name of SELECT_WORKFLOWS) {
  test(`${name}: selects skills from the catalog in one fast-tier call`, () => {
    const out = buildWorkflow(name, fragmentsFor(name));
    assert.ok(/function selectAndRenderSkills/.test(out), 'selectAndRenderSkills inlined');
    assert.ok(/selectAndRenderSkills\(/.test(out), 'selectAndRenderSkills called');
    // Its catalog prefilter dependency must be inlined too (the one allowed
    // fragment import shape is stripped at build time).
    assert.ok(/function buildDiscoverCatalogCommand/.test(out), 'catalog prefilter inlined');
    assert.ok(!/^import\s/m.test(out), 'no import survives into the bundle');
  });
}

for (const [name, reason] of Object.entries(NO_SKILLS)) {
  test(`${name}: intentionally has no skill rendering (${reason})`, () => {
    const out = buildWorkflow(name, fragmentsFor(name));
    assert.ok(!/selectAndRenderSkills\(/.test(out), `${name} should not select skills: ${reason}`);
  });
}

test('selectAndRenderSkills never throws the workflow (skills are additive)', () => {
  const src = readFileSync(join(ROOT, 'src/fragments/skill-render.js'), 'utf8');
  const fn = src.slice(src.indexOf('export async function selectAndRenderSkills'));
  assert.ok(/catch \(e\)/.test(fn), 'has a catch');
  assert.ok(!/throw new Error/.test(fn.slice(0, fn.indexOf('warnIfSkillsDropped'))),
    'does not rethrow — a workflow that had no skills before must not start failing');
});

// --- flat-name derivation (native discovery) ---

const NAMER = join(ROOT, 'scripts/skill-flat-names.py');

function runNamer(catalogBody, scope = 'host', alias = 'n') {
  const dir = mkdtempSync(join(tmpdir(), 'zkskills-'));
  const file = join(dir, 'CATALOG.md');
  writeFileSync(file, catalogBody);
  const out = execFileSync('python3', [NAMER, file, scope, alias], { encoding: 'utf8' });
  return out.trim().split('\n').filter(Boolean).map(l => l.split('\t'));
}

const CATALOG = [
  '# Skill Catalog',
  '',
  '- `agent/machine-persona` — persona resolver',
  '- `agent/machines/n/nebo/jira` — internal jira',
  '- `agent/machines/n/repos/infra-salt` — salt states',
  '- `agent/machines/n1/repos/server` — other host',
  '- `agent/machines/archive/pg/argocd-legacy` — archived',
  '- `general/practices/code-review` — review',
  '- `general/infrastructure/kubernetes` — k8s',
  '- `system/tools/bd` — beads',
  '- `system/development/graph` — graph',
].join('\n');

test('flat names: leaf when unique', () => {
  const pairs = runNamer(CATALOG);
  const map = Object.fromEntries(pairs.map(([n, id]) => [id, n]));
  assert.equal(map['agent/machines/n/nebo/jira'], 'jira');
  assert.equal(map['general/practices/code-review'], 'code-review');
  assert.equal(map['system/development/graph'], 'graph');
});

test('flat names: other hosts and archive are excluded at host scope, kept with --all', () => {
  const hostIds = runNamer(CATALOG).map(([, id]) => id);
  assert.ok(!hostIds.includes('agent/machines/n1/repos/server'), 'other host excluded');
  assert.ok(!hostIds.includes('agent/machines/archive/pg/argocd-legacy'), 'archive excluded');
  assert.ok(hostIds.includes('agent/machines/n/repos/infra-salt'), 'own host kept');

  const allIds = runNamer(CATALOG, 'all').map(([, id]) => id);
  assert.ok(allIds.includes('agent/machines/n1/repos/server'), '--all keeps other hosts');
  assert.ok(allIds.includes('agent/machines/archive/pg/argocd-legacy'), '--all keeps archive');
});

test('flat names: collisions disambiguate and stay unique', () => {
  const catalog = [
    '- `general/languages/python-development` — a',
    '- `agent/machines/n/repos/development` — b',
    '- `system/development/development` — c',
  ].join('\n');
  const pairs = runNamer(catalog);
  const names = pairs.map(([n]) => n);
  assert.equal(new Set(names).size, names.length, `names must be unique: ${names.join(', ')}`);
  assert.ok(names.includes('python-development'), 'unique leaf keeps its leaf name');
});

test('flat names: deterministic across runs', () => {
  assert.deepEqual(runNamer(CATALOG), runNamer(CATALOG));
});

test('install-skills.sh: executable, idempotent-by-check, prunes stale links', () => {
  const script = join(ROOT, 'scripts/install-skills.sh');
  assert.ok(existsSync(script), 'script exists');
  assert.ok(statSync(script).mode & 0o111, 'script is executable');
  const body = readFileSync(script, 'utf8');
  assert.ok(/--check/.test(body), 'supports --check for /health');
  assert.ok(/not in catalog/.test(body), 'prunes links whose catalog id is gone');
  assert.ok(/ln -sfn/.test(body), 'installs by symlink (source stays single-copy)');
  // Never clobber a real directory a human put there by hand.
  assert.ok(/is not a symlink — left untouched/.test(body), 'refuses to overwrite non-symlinks');
  execFileSync('bash', ['-n', script]);   // syntax check
});

test('onboard + health both wire skills', () => {
  const onboard = readFileSync(join(ROOT, 'scripts/onboard.sh'), 'utf8');
  assert.ok(/gen-skill-catalog\.sh/.test(onboard), 'onboard checks catalog freshness');
  assert.ok(/install-skills\.sh/.test(onboard), 'onboard installs native skills');
  const health = readFileSync(join(ROOT, '.claude/commands/health.md'), 'utf8');
  assert.ok(/gen-skill-catalog\.sh/.test(health) && /"\$s_gen" --check/.test(health),
    'health fails on a stale catalog');
  assert.ok(/install-skills\.sh"? --check/.test(health), 'health fails when links are out of sync');
  assert.ok(/CATALOG\.md is stale/.test(health), 'stale catalog reports a FAIL line with the fix');
});

test('every non-exempt agent carries an output budget in its own output shape', () => {
  // The rule demanded a budget line on every agent, but 16 lacked one and the canonical
  // findings[]-shaped line only fits the review perspectives. Exemptions are explicit.
  const dir = join(ROOT, '.claude/agents');
  const exempt = new Set(['persist', 'goal-scout', 'goal-judge', 'goal-worker']);
  const missing = readdirSync(dir)
    .filter(f => f.endsWith('.md'))
    .map(f => f.replace('.md', ''))
    .filter(n => !exempt.has(n))
    .filter(n => !/Output budget/i.test(readFileSync(join(dir, `${n}.md`), 'utf8')));
  assert.deepEqual(missing, [], `agents with no output budget: ${missing}`);
});

test('agent tool grants stay in sync with the context-mode instruction', () => {
  // A prompt telling an agent to use ctx_execute is useless without the tool grant.
  for (const n of ['test-runner', 'grader', 'evidence-scanner']) {
    const s = readFileSync(join(ROOT, '.claude/agents', `${n}.md`), 'utf8');
    assert.ok(/mcp__plugin_context-mode/.test(s), `${n}: context-mode granted`);
  }
});

test('install-skills defers to the plugin instead of duplicating it', () => {
  // Adding the zkengine plugin made /onboard publish every skill TWICE — zk-humanizer via
  // symlink AND zkengine:humanizer via the plugin — for zero added coverage, doubling what
  // the model reads in its skill listing.
  const body = readFileSync(join(ROOT, 'scripts/install-skills.sh'), 'utf8');
  assert.match(body, /PLUGIN_PRESENT/, 'detects the installed plugin');
  assert.match(body, /covered_by_plugin/, 'counts and reports what it skipped');
  // The split is by whether the skill dir resolves outside the repo: a plugin cache does
  // not follow symlinks out of the plugin, so those are the only ones it cannot carry.
  assert.match(body, /pwd -P/, 'resolves the real path to decide');
  assert.match(body, /"\$ZK_ARTIFACTS_DIR"\/\*\) covered_by_plugin/,
    'dirs inside the repo are left to the plugin');
  // --all must still install everything (a machine with no plugin).
  assert.match(body, /\[ "\$SCOPE" != "all" \]/, '--all bypasses the plugin deferral');
});

test('health asserts every catalog skill is reachable exactly once', () => {
  const health = readFileSync(join(ROOT, '.claude/commands/health.md'), 'utf8');
  assert.match(health, /unreachable skill:/, 'fails when a skill is reachable by neither path');
  assert.match(health, /published TWICE/, 'fails when a skill is reachable by both');
});
