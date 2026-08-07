// tests/daily-scripts.test.js
// Bash behavior of the tokenless accumulator and the rollup guards.
// bd-writing path of rollup is integration-only (needs a bd db) and not tested here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, execSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, existsSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = dirname(fileURLToPath(import.meta.url));
const REPO = join(ROOT, '..');
const ACC = join(REPO, 'scripts/daily-accumulate.sh');
const ROLL = join(REPO, 'scripts/daily-rollup.sh');
const HOST = execSync('hostname -s', { encoding: 'utf8' }).trim().toLowerCase();
const today = () => execSync('date +%Y%m%d', { encoding: 'utf8' }).trim();

function freshDir() { return mkdtempSync(join(tmpdir(), 'zkdaily-')); }

test('accumulate appends a jq-parseable line and touches last-activity', () => {
  const DIR = freshDir();
  const payload = JSON.stringify({ cwd: '/tmp/some/repo', last_assistant_message: 'did a thing' });
  execFileSync(ACC, [], { input: payload, env: { ...process.env, ZKFLOW_DAILY_DIR: DIR } });
  const log = join(DIR, `${HOST}-${today()}.jsonl`);
  assert.ok(existsSync(log), 'host-scoped log created');
  const line = JSON.parse(readFileSync(log, 'utf8').trim().split('\n')[0]);
  assert.equal(line.cwd, '/tmp/some/repo');
  assert.equal(line.prompt, 'did a thing');
  assert.equal(typeof line.ts, 'number');
  assert.ok(existsSync(join(DIR, `${HOST}.last-activity`)), 'last-activity touched');
});

test('accumulate filename host is lowercased', () => {
  const DIR = freshDir();
  execFileSync(ACC, [], { input: '{"cwd":"/x"}', env: { ...process.env, ZKFLOW_DAILY_DIR: DIR } });
  const files = readdirSync(DIR).filter(f => f.endsWith('.jsonl'));
  assert.equal(files.length, 1);
  assert.equal(files[0], files[0].toLowerCase(), 'filename is lowercase');
});

test('accumulate exits 0 on garbage stdin (never breaks the turn)', () => {
  const DIR = freshDir();
  // should not throw — exit 0 even on non-JSON input
  assert.doesNotThrow(() =>
    execFileSync(ACC, [], { input: 'not json at all {{{', env: { ...process.env, ZKFLOW_DAILY_DIR: DIR } }));
});

test('rollup idle-guard no-ops when last-activity is recent', () => {
  const DIR = freshDir();
  // seed a scratch log + a JUST-NOW activity marker
  writeFileSync(join(DIR, `${HOST}-${today()}.jsonl`), '{"cwd":"/x","bead":"","ts":1}\n');
  writeFileSync(join(DIR, `${HOST}.last-activity`), '');
  const out = execFileSync(ROLL, [], {
    encoding: 'utf8',
    env: { ...process.env, ZKFLOW_DAILY_DIR: DIR, ZKFLOW_IDLE_HOURS: '2' },
  });
  assert.match(out, /not idle yet/);
});

test('rollup no-ops when there is no scratch for today', () => {
  const DIR = freshDir();
  const out = execFileSync(ROLL, [], {
    encoding: 'utf8',
    env: { ...process.env, ZKFLOW_DAILY_DIR: DIR, ZKFLOW_IDLE_HOURS: '0' },
  });
  assert.match(out, /no scratch/);
});

test('rollup once-per-day guard no-ops when already rolled today', () => {
  const DIR = freshDir();
  writeFileSync(join(DIR, `${HOST}-${today()}.jsonl`), '{"cwd":"/x","bead":"","ts":1}\n');
  const act = join(DIR, `${HOST}.last-activity`);
  writeFileSync(act, '');
  // make activity old enough to pass idle guard (set mtime 3h ago)
  const old = Date.now() / 1000 - 3 * 3600;
  utimesSync(act, old, old);
  // mark today as already rolled
  writeFileSync(join(DIR, `${HOST}.last-rollup-date`), today());
  const out = execFileSync(ROLL, [], {
    encoding: 'utf8',
    env: { ...process.env, ZKFLOW_DAILY_DIR: DIR, ZKFLOW_IDLE_HOURS: '2' },
  });
  assert.match(out, /already rolled/);
});
