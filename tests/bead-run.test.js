// tests/bead-run.test.js
// Unit tests for runBeadId (pure function). Guards bead-id derivation so runs
// get distinct beads instead of all collapsing onto 'zk-flow-run'.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = dirname(fileURLToPath(import.meta.url));
// runBeadId is an inlined fragment (no module exports at runtime). Eval the
// source's function body in isolation for a pure unit test.
const SRC = readFileSync(join(ROOT, '..', 'src/fragments/bead-run.js'), 'utf8');
const fnSrc = SRC.match(/export function runBeadId\(a\) \{[\s\S]*?\n\}/)[0].replace(/^export\s+/, '');
// eslint-disable-next-line no-new-func
const runBeadId = new Function(`${fnSrc}; return runBeadId;`)();

function loadFn(name) {
  const m = SRC.match(new RegExp(`export function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}`));
  // eslint-disable-next-line no-new-func
  return new Function(`${m[0].replace(/^export\s+/, '')}; return ${name};`)();
}
const workspaceBranch = loadFn('workspaceBranch');
const buildProofOfWork = (() => {
  const names = ['workspaceBranch', 'buildProofOfWork'];
  const bodies = names.map(n => SRC.match(new RegExp(`export function ${n}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}`))[0].replace(/^export\s+/, '')).join('\n');
  // eslint-disable-next-line no-new-func
  return new Function(`${bodies}; return buildProofOfWork;`)();
})();
const workspaceBootstrap = (() => {
  // workspaceBootstrap calls workspaceBranch — load both together
  const names = ['workspaceBranch', 'workspaceBootstrap'];
  const bodies = names.map(n => SRC.match(new RegExp(`export function ${n}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}`))[0].replace(/^export\s+/, '')).join('\n');
  // eslint-disable-next-line no-new-func
  return new Function(`${bodies}; return workspaceBootstrap;`)();
})();
const workspaceBootstrapRepos = loadFn('workspaceBootstrapRepos');

test('workspaceBootstrapRepos always emits the zkiso procedure (keyed on bead)', () => {
  // Even with no files it must emit the procedure — the writer calls zkiso with
  // absolute repo paths from the request; the file list is only a hint.
  const b = workspaceBootstrapRepos('zk-flow-feat-1', []);
  assert.match(b, /External-repo isolation — RUN FIRST/);
  assert.match(b, /BEAD='zk-flow-feat-1'/);
  assert.match(b, /zkiso\(\) \{/);
  assert.match(b, /rev-parse --show-toplevel/);
  // worktree branches off the repo's origin default, NOT the checked-out branch
  assert.match(b, /worktree add "\$ws" -b "\$br" "\$base"/);
  assert.match(b, /symbolic-ref --quiet --short refs\/remotes\/origin\/HEAD/);
  assert.match(b, /edit & commit HERE, not \$root/);
});

test('workspaceBootstrapRepos accepts {file} objects and surfaces only absolute paths', () => {
  const b = workspaceBootstrapRepos('zk-flow-feat-1', [
    { file: '/Users/x/dev/repo-a/states/a.sls', change: 'new' },
    { file: 'repo-b/svc/main.py', change: 'new' }, // relative -> not surfaced
    '/Users/x/dev/repo-c/x.py',
  ]);
  assert.match(b, /Absolute target paths seen:/);
  assert.match(b, /\/Users\/x\/dev\/repo-a\/states\/a\.sls/);
  assert.match(b, /\/Users\/x\/dev\/repo-c\/x\.py/);
  assert.doesNotMatch(b, /repo-b\/svc\/main\.py/); // relative path excluded from hint
});

test('workspaceBootstrapRepos drops shell-unsafe paths from the hint (no injection)', () => {
  const b = workspaceBootstrapRepos('zk-flow-x', ['/tmp/ok.py', "/tmp/ev'il.py"]);
  assert.match(b, /\/tmp\/ok\.py/);
  assert.doesNotMatch(b, /ev'il/);
});

test('bead= is used verbatim (normalized) for run-1/run-2 correlation', () => {
  assert.equal(runBeadId({ bead: 'zk-flow-Abc_123' }), 'zk-flow-abc-123');
});

test('bead= without the zk-flow- prefix gets it (db prefix guard)', () => {
  // bd db enforces a zk-flow- prefix; an unprefixed bead= (e.g. an external
  // tracker key) would fail bd create and abort every persist. Must be normalized.
  assert.equal(runBeadId({ bead: 'PROJ-3312' }), 'zk-flow-proj-3312');
  assert.equal(runBeadId({ bead: 'proj-3311' }), 'zk-flow-proj-3311');
});

test('bead= already prefixed is not double-prefixed', () => {
  assert.equal(runBeadId({ bead: 'zk-flow-proj-3312' }), 'zk-flow-proj-3312');
});

test('pr= derives a stable pr-prefixed id', () => {
  assert.equal(runBeadId({ pr: 'https://github.com/o/r/pull/9' }), 'zk-flow-pr-https-github-com-o-r-pull-9');
});

test('positional text slugs the bead', () => {
  assert.equal(runBeadId({ _: ['add', 'rate', 'limiting'] }), 'zk-flow-add-rate-limiting');
});

test('brief= slugs the bead when there is no positional (no collision on zk-flow-run)', () => {
  const id = runBeadId({ brief: 'Add a model-escalation ladder to runPhase' });
  assert.notEqual(id, 'zk-flow-run', 'brief-only invocations must not collapse onto zk-flow-run');
  assert.match(id, /^zk-flow-add-a-model-escalation-ladder/);
});

test('empty args fall back to zk-flow-run', () => {
  assert.equal(runBeadId({}), 'zk-flow-run');
});

test('positional wins over brief when both present', () => {
  assert.equal(runBeadId({ _: ['fix', 'login'], brief: 'something else' }), 'zk-flow-fix-login');
});

// --- deterministic per-bead run branch (zk-flow-ts2 fix; runtime isolation:worktree) ---
test('workspaceBranch is zkflow/<beadId>', () => {
  assert.equal(workspaceBranch('zk-flow-add-x'), 'zkflow/zk-flow-add-x');
});

test('workspaceBootstrap (writer) continues-or-creates the run branch — no worktree add, no cd', () => {
  const b = workspaceBootstrap('zk-flow-add-x');
  assert.match(b, /Workspace bootstrap — RUN FIRST/);
  assert.match(b, /BR="zkflow\/zk-flow-add-x"/);
  // continue-or-create: fresh per-iteration isolation worktrees must NOT -B-reset
  // the branch (that would discard earlier iterations' commits)
  assert.match(b, /git checkout "\$BR" 2>\/dev\/null \|\| git checkout -B "\$BR"/);
  assert.doesNotMatch(b, /git worktree add/);       // runtime isolation provides the worktree, not us
  assert.doesNotMatch(b, /\bcd /);                  // no cd — agent is already sandboxed
  assert.doesNotMatch(b, /git fetch/);              // no fetch by default
});

test('workspaceBootstrap (finish-pr writer) continues the existing PR branch, never resets it', () => {
  const b = workspaceBootstrap('zk-flow-pr-9', { branch: 'feature/login', fetch: true });
  assert.match(b, /BR="feature\/login"/);
  assert.match(b, /git fetch origin "\$BR"/);       // fetch the remote PR branch first
  assert.match(b, /git checkout "\$BR"/);           // checkout existing (extend it), not -B reset
  assert.match(b, /origin\/\$BR/);                  // fall back to the remote-tracking branch
});

test('workspaceBootstrap (reader/pr-author) reads the writer branch without discarding commits', () => {
  const b = workspaceBootstrap('zk-flow-add-x', { checkoutOnly: true });
  assert.match(b, /git checkout "\$BR" 2>\/dev\/null/);  // plain checkout (read) first
  assert.match(b, /origin\/\$BR/);                       // reset only as a remote fallback
});

// --- proof-of-work artifact (#2) ---
test('buildProofOfWork (feature) bundles verdict/branch/files/review/tests', () => {
  const pow = buildProofOfWork({
    verdict: 'APPROVE', route: 'done', beadId: 'zk-flow-x',
    implResult: { out: { files_changed: [{ file: 'a.js' }], commits: [{ sha: 'abc' }] } },
    reviewGrade: { verdict: 'APPROVE' },
    testing: { out: { tests_passed: 12, tests_failed: 0, outcome: 'testing_complete', smoke_exit_code: 0 } },
  });
  assert.equal(pow.bead, 'zk-flow-x');
  assert.equal(pow.branch, 'zkflow/zk-flow-x');
  assert.equal(pow.verdict, 'APPROVE');
  assert.equal(pow.review, 'APPROVE');
  assert.deepEqual(pow.tests, { passed: 12, failed: 0, outcome: 'testing_complete', smoke_exit_code: 0 });
  assert.equal(pow.files_changed.length, 1);
  assert.equal(pow.commits.length, 1);
  // self-resolving cost hint: non-empty, mentions run-cost, embeds the locator
  assert.equal(typeof pow.cost_cmd, 'string');
  assert.ok(pow.cost_cmd.length > 0);
  assert.match(pow.cost_cmd, /run-cost/);
  assert.match(pow.cost_cmd, /subagents/);
});

test('buildProofOfWork (small-feature) is null-safe with no reviewGrade', () => {
  const pow = buildProofOfWork({
    verdict: 'APPROVE', route: 'done', beadId: 'zk-flow-y',
    implResult: { out: { files_changed: [] } },
    testing: { out: { tests_passed: 5, tests_failed: 1, outcome: 'testing_complete', smoke_exit_code: 0 } },
  });
  assert.equal(pow.review, null);          // small-feature has no review council
  assert.deepEqual(pow.tests, { passed: 5, failed: 1, outcome: 'testing_complete', smoke_exit_code: 0 });
  assert.deepEqual(pow.files_changed, []);
  assert.deepEqual(pow.commits, []);
});

test('buildProofOfWork preserves smoke_unsupported signal (zk-flow-pna)', () => {
  // smoke_unsupported testing has no tests_passed/failed; proof must still record
  // that testing ran (outcome + exit 0) rather than a bare {passed:null,failed:null}.
  const pow = buildProofOfWork({
    verdict: 'APPROVE', route: 'done', beadId: 'zk-flow-pna',
    implResult: { out: { files_changed: [] } },
    testing: { out: { outcome: 'smoke_unsupported', smoke_command: 'make test', smoke_exit_code: 0 } },
  });
  assert.notEqual(pow.tests, null, 'tests object present even without tests_passed');
  assert.equal(pow.tests.passed, null);
  assert.equal(pow.tests.failed, null);
  assert.equal(pow.tests.outcome, 'smoke_unsupported');
  assert.equal(pow.tests.smoke_exit_code, 0);
});

test('buildProofOfWork tolerates missing implResult/testing', () => {
  const pow = buildProofOfWork({ verdict: 'APPROVE', route: 'done', beadId: 'zk-flow-z' });
  assert.deepEqual(pow.files_changed, []);
  assert.equal(pow.tests, null);
  assert.equal(pow.review, null);
});
