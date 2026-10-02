// tests/zkflow-daemon.test.js
// Verifies the bead->workflow mapping, label scoping, and dry-run safety of
// scripts/zkflow-daemon.sh. Uses the ZKFLOW_BD_READY override so no bd/claude
// is required. Never runs with --execute here (would dispatch real workflows).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'zkflow-daemon.sh');
const run = (ready, args = []) =>
  execFileSync('bash', [SCRIPT, ...args], { encoding: 'utf8', env: { ...process.env, ZKFLOW_BD_READY: JSON.stringify(ready) } });

test('maps bugs to /debug and everything else to /feature, with bead= correlation', () => {
  const out = run([
    { id: 'zk-flow-oauth', title: 'Add OAuth' },
    { id: 'zk-flow-bug1', title: 'Login fails', type: 'bug' },
    { id: 'zk-flow-fix2', title: 'Fix timeout regression' },
  ]);
  assert.match(out, /\[feature\] zk-flow-oauth -> \/feature bead=zk-flow-oauth/);
  assert.match(out, /\[debug\] zk-flow-bug1 -> \/debug bead=zk-flow-bug1/);
  assert.match(out, /\[debug\] zk-flow-fix2 -> \/debug bead=zk-flow-fix2/);   // title heuristic
});

test('default is dry-run — nothing is dispatched', () => {
  const out = run([{ id: 'a', title: 'x' }]);
  assert.match(out, /dry-run — nothing dispatched/);
  assert.doesNotMatch(out, /dispatch: claude/);   // no headless invocation
});

test('--label scopes to beads carrying that label', () => {
  const out = run([
    { id: 'a', title: 'feature x', labels: ['auto'] },
    { id: 'b', title: 'feature y' },
  ], ['--label', 'auto']);
  assert.match(out, /ready beads to dispatch: 1/);
  assert.match(out, /\ba -> /);
  assert.doesNotMatch(out, /\bb -> /);
});

test('empty ready board dispatches nothing', () => {
  const out = run([]);
  assert.match(out, /ready beads to dispatch: 0/);
});

test('dry-run announces the cost-report it WOULD run, with the two-wildcard locator, and runs nothing', () => {
  const out = run([{ id: 'a', title: 'x' }]);
  // (a) the gated cost-report is announced as WOULD (not actually invoked)
  assert.match(out, /WOULD cost-report/);
  // (b) regression guard for the wrong-glob bug: the locator must mirror
  // run-cost.sh's depth-agnostic find -path '*subagents*' -name 'wf_*' shape.
  assert.match(out, /-path '\*subagents\*' -name 'wf_\*'/);
  // (c) no real run-cost invocation under dry-run
  assert.doesNotMatch(out, /cost-report \(showing newest/);
  assert.doesNotMatch(out, /Run cost: \$/);
});
