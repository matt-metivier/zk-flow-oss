// tests/eval-tool.test.js
// End-to-end execution of the built eval-tool workflow with a stubbed harness
// (agent/phase globals; fragments are inlined by build). Validates the control
// flow the live /eval-tool run would exercise: intake -> assess(schema) -> verdict
// -> catalog -> lift-route seam, idempotent-by-repo, and NEVER auto-merge/auto-chain.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildWorkflow, fragmentsFor } from '../build.js';

const ROOT = dirname(fileURLToPath(import.meta.url));
const REPO = join(ROOT, '..');
const SRC = readFileSync(join(REPO, 'src/workflows/eval-tool.src.js'), 'utf8');

function compileWorkflow() {
  const out = buildWorkflow('eval-tool', fragmentsFor('eval-tool'));
  const stripped = out.replace(/^export\s+/gm, '');
  // eslint-disable-next-line no-new-func
  return new Function('args', 'agent', 'phase', `"use strict"; return (async () => { ${stripped} })();`);
}

// Stub harness: classify each agent() call by its label and return a shaped result.
function makeHarness(verdictsByRepo) {
  const calls = [];
  const phases = [];
  const agent = async (prompt, opts = {}) => {
    const label = opts.label || '';
    calls.push({ label, prompt, opts });
    if (label === 'preflight:bd') return { ok: true };
    if (label.startsWith('intake:')) {
      return { repo: label.slice('intake:'.length), license: 'MIT', purpose: 'x', entry_points: [], claims: '', evidence: [] };
    }
    if (label.startsWith('assess:')) {
      const repo = label.slice('assess:'.length);
      return verdictsByRepo[repo];
    }
    return 'done';
  };
  const phase = (name) => { phases.push(name); };
  return { agent, phase, calls, phases };
}

test('eval-tool builds and compiles (no surviving imports / scope errors)', () => {
  const out = buildWorkflow('eval-tool', fragmentsFor('eval-tool'));
  assert.doesNotMatch(out, /^import\s/m, 'bundle must be import-free');
  assert.doesNotThrow(() => compileWorkflow());
});

test('source never auto-merges or auto-chains workflows', () => {
  assert.doesNotMatch(SRC, /git\s+merge|gh\s+pr\s+merge|checkout\s+-b/, 'eval-tool must not stage/merge branches');
  // lift-route emits a command via handoff, it does not invoke workflow()/agent-chain
  assert.doesNotMatch(SRC, /workflow\(/, 'lift-route must not auto-invoke another workflow');
});

test('end-to-end: INSPIRE(skill) -> /improve, ADOPT(code) -> /feature, REJECT -> no lift', async () => {
  process.env.ZK_ARTIFACTS_DIR = process.env.ZK_ARTIFACTS_DIR || '/tmp/zk-artifacts-test';
  const verdicts = {
    'https://github.com/x/skilltext': {
      repo: 'https://github.com/x/skilltext', license: 'MIT', verdict: 'INSPIRE',
      overlaps: 'humanizer', liftable_patterns: ['YAGNI restraint note -> design rubric'],
      integration_analysis: 'lift into rubric', revisit_if: '',
    },
    'https://github.com/y/codelift': {
      repo: 'https://github.com/y/codelift', license: 'MIT', verdict: 'ADOPT', lifecycle: 'ADOPTED 2026-06-16',
      overlaps: 'none', liftable_patterns: ['new fragment in src/ for backtrack workflow recovery'],
      integration_analysis: 'code lift', revisit_if: '',
    },
    'https://github.com/z/rejectme': {
      repo: 'https://github.com/z/rejectme', license: 'NOASSERTION', verdict: 'REJECT',
      overlaps: 'platform', liftable_patterns: [], integration_analysis: 'out of category', revisit_if: '',
    },
  };
  const h = makeHarness(verdicts);
  const run = compileWorkflow();
  const result = await run(
    'https://github.com/x/skilltext https://github.com/y/codelift https://github.com/z/rejectme',
    h.agent, h.phase
  );

  assert.equal(result.verdict, 'evaluated');
  assert.equal(result.evaluated, 3);

  const byRepo = Object.fromEntries(result.results.map(r => [r.repo, r]));
  // INSPIRE + non-code pattern -> /improve command
  assert.ok(byRepo['https://github.com/x/skilltext'].lift, 'INSPIRE with patterns must produce a lift');
  assert.match(byRepo['https://github.com/x/skilltext'].lift.command, /^\/improve/);
  // ADOPT + code pattern -> /feature command
  assert.match(byRepo['https://github.com/y/codelift'].lift.command, /^\/feature/);
  // REJECT -> no lift
  assert.equal(byRepo['https://github.com/z/rejectme'].lift, null, 'REJECT must not produce a lift');

  // catalog upsert ran once per repo
  const catalogCalls = h.calls.filter(c => c.label.startsWith('catalog:'));
  assert.equal(catalogCalls.length, 3);
  // assess enforced the eval schema
  const assessCalls = h.calls.filter(c => c.label.startsWith('assess:'));
  assert.ok(assessCalls.every(c => c.opts.schema && c.opts.schema.title === 'ToolEval'), 'assess must pass SCHEMAS.eval');
  // phases visited
  assert.ok(h.phases.includes('Intake') && h.phases.includes('Catalog') && h.phases.includes('LiftRoute'));
});

test('no repo url -> needs_human handoff (does not crash)', async () => {
  process.env.ZK_ARTIFACTS_DIR = process.env.ZK_ARTIFACTS_DIR || '/tmp/zk-artifacts-test';
  const h = makeHarness({});
  const run = compileWorkflow();
  const result = await run('window=1', h.agent, h.phase); // no positional url
  assert.equal(result.verdict, 'needs_human');
  assert.equal(result.phase, 'intake');
});
