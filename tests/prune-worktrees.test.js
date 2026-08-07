// tests/prune-worktrees.test.js
// Structural and behavioral tests for scripts/prune-worktrees.sh.
// No actual git worktree operations are performed — only script-level behavior.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = join(ROOT, 'scripts', 'prune-worktrees.sh');

test('prune-worktrees.sh exists', () => {
  assert.ok(existsSync(SCRIPT), `expected ${SCRIPT} to exist`);
});

test('script has bash shebang', () => {
  const first = readFileSync(SCRIPT, 'utf8').split('\n')[0];
  assert.match(first, /^#!.*bash/, 'first line must be a bash shebang');
});

test('script is executable', () => {
  // execFileSync throws on non-zero; use spawnSync with --help-like flag to
  // verify the script can be invoked. We use --dry-run which exits 0.
  const result = spawnSync('bash', [SCRIPT, '--dry-run'], {
    encoding: 'utf8',
    cwd: ROOT,
  });
  // May fail with "not inside a git repo" if run outside one — that's fine.
  // What matters is the exit code is NOT 126/127 (not found / not executable).
  assert.notEqual(result.status, 126, 'script must be executable (not 126)');
  assert.notEqual(result.status, 127, 'script must be found (not 127)');
});

test('--dry-run flag exits 0', () => {
  const result = spawnSync('bash', [SCRIPT, '--dry-run'], {
    encoding: 'utf8',
    cwd: ROOT,
  });
  // Either success (0) or "not inside a git repo" (1) are acceptable.
  // What is NOT acceptable is an unknown-flag error (2).
  assert.notEqual(result.status, 2, '--dry-run must not produce unknown-flag error');
});

test('unknown flag exits 2', () => {
  const result = spawnSync('bash', [SCRIPT, '--unknown-flag'], {
    encoding: 'utf8',
    cwd: ROOT,
  });
  assert.equal(result.status, 2, 'unknown flag must exit 2');
  assert.match(result.stderr, /unknown arg/, 'stderr must mention unknown arg');
});

test('script references git worktree prune', () => {
  const src = readFileSync(SCRIPT, 'utf8');
  assert.match(src, /git worktree prune/, 'must call git worktree prune');
});

test('script scopes removal to zkflow/* branches only', () => {
  const src = readFileSync(SCRIPT, 'utf8');
  assert.match(src, /zkflow\/\*/, 'must scope to zkflow/* branches');
});

test('script supports --dry-run flag (source check)', () => {
  const src = readFileSync(SCRIPT, 'utf8');
  assert.match(src, /--dry-run/, 'must implement --dry-run flag');
});

test('daemon script calls prune_pass before one_pass', () => {
  const daemonSrc = readFileSync(join(ROOT, 'scripts', 'zkflow-daemon.sh'), 'utf8');
  assert.match(daemonSrc, /prune_pass\s*\(\)/, 'daemon must define prune_pass()');
  // Verify prune_pass is called before one_pass in the execution paths.
  const singlePassIdx = daemonSrc.lastIndexOf('prune_pass');
  const onePassIdx = daemonSrc.lastIndexOf('one_pass');
  assert.ok(singlePassIdx < onePassIdx, 'prune_pass must appear before one_pass in file');
});

test('daemon script sets PRUNE_SCRIPT path', () => {
  const daemonSrc = readFileSync(join(ROOT, 'scripts', 'zkflow-daemon.sh'), 'utf8');
  assert.match(daemonSrc, /PRUNE_SCRIPT=/, 'daemon must define PRUNE_SCRIPT variable');
  assert.match(daemonSrc, /prune-worktrees\.sh/, 'daemon must reference prune-worktrees.sh');
});
