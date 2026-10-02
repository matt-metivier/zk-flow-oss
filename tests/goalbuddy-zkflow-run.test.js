// tests/goalbuddy-zkflow-run.test.js
// Unit tests for the GoalBuddy<->zk-flow Option-A bridge. Exercises the PURE
// logic only — workflow/arg mapping (feature/bugfix/finish-pr selection,
// autoApprove injection), the non-interactive `claude -p` command shape, and
// ProofOfWork->receipt extraction. bd output is mocked; claude is never spawned.
// runBridge is driven with injected deps (runHeadless/readBdComments/log) so no
// real DB/CLI is hit. Same node:test style as zkflow-daemon.test.js /
// bd-memory.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import {
  parseCliArgs,
  looksLikeBug,
  selectWorkflow,
  buildSlashCommand,
  buildHeadlessArgv,
  formatHeadlessCommand,
  extractProofOfWork,
  proofOfWorkToReceipt,
  resolveReadBead,
  runBridge,
  DEFAULT_PERMISSION_MODE,
  computeProvisionPlan,
  computeCleanupPlan,
  formatProvisionPlan,
  applyProvision,
  cleanupProvision,
  resolveSourceRoot,
  PROVISION_DIRS,
  bdProbeSaysNotOperational,
  sandboxBeadsDir,
  withNonInteractiveDirective,
} from '../scripts/goalbuddy-zkflow-run.mjs';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'goalbuddy-zkflow-run.sh');

// ---- workflow selection -----------------------------------------------------

test('selectWorkflow: explicit workflow= wins', () => {
  assert.equal(selectWorkflow({ workflow: 'feature', pr: 'x' }), 'feature');
  assert.equal(selectWorkflow({ workflow: 'small-feature', brief: 'add thing' }), 'small-feature');
  assert.equal(selectWorkflow({ workflow: 'bugfix', brief: 'old name' }), 'debug'); // legacy alias -> debug
  assert.equal(selectWorkflow({ workflow: 'finish-pr', pr: 'p' }), 'finish-pr');
});

test('selectWorkflow: pr= -> finish-pr, bug-shaped brief -> debug, else feature', () => {
  assert.equal(selectWorkflow({ pr: 'https://x/pull/1' }), 'finish-pr');
  assert.equal(selectWorkflow({ brief: 'Login fails on Safari' }), 'debug');
  assert.equal(selectWorkflow({ brief: 'add rate limiting' }), 'feature');
  assert.equal(selectWorkflow({ bead: 'zk-flow-fix-timeout' }), 'debug');
});

test('selectWorkflow: rejects unknown workflow', () => {
  assert.throws(() => selectWorkflow({ workflow: 'deploy' }), /unknown workflow/);
});

test('looksLikeBug heuristic mirrors the daemon', () => {
  assert.ok(looksLikeBug('fix the regression'));
  assert.ok(looksLikeBug('login is broken'));
  assert.ok(!looksLikeBug('add a dashboard'));
});

// ---- slash-command building (autoApprove injection) -------------------------

test('feature command injects autoApprove=true and threads bead+brief', () => {
  const cmd = buildSlashCommand('feature', { bead: 'zk-flow-oauth', brief: 'add oauth' });
  assert.match(cmd, /^\/feature autoApprove=true/);
  assert.match(cmd, /bead=zk-flow-oauth/);
  assert.match(cmd, /brief="add oauth"/);
});

test('bugfix command does NOT inject autoApprove (no design seam)', () => {
  const cmd = buildSlashCommand('bugfix', { brief: 'fix timeout' });
  assert.doesNotMatch(cmd, /autoApprove/);
  assert.match(cmd, /^\/bugfix /);
  assert.match(cmd, /brief="fix timeout"/);
});

test('small-feature command translates to /feature profile=small (small-feature workflow was retired)', () => {
  const cmd = buildSlashCommand('small-feature', { brief: 'add a flag' });
  assert.match(cmd, /^\/feature /);
  assert.match(cmd, /profile=small/);
  assert.doesNotMatch(cmd, /autoApprove/, 'no design seam -- must not inject autoApprove');
  assert.match(cmd, /brief="add a flag"/);
});

test('finish-pr command carries pr= and requires it', () => {
  const cmd = buildSlashCommand('finish-pr', { pr: 'https://github.com/o/r/pull/7' });
  assert.equal(cmd, '/finish-pr pr=https://github.com/o/r/pull/7');
  assert.throws(() => buildSlashCommand('finish-pr', {}), /requires pr=/);
});

test('feature/bugfix require bead= or brief=', () => {
  assert.throws(() => buildSlashCommand('feature', {}), /requires bead=|brief=/);
  assert.throws(() => buildSlashCommand('bugfix', {}), /requires bead=|brief=/);
});

test('skipReview / startAt pass through when set', () => {
  const cmd = buildSlashCommand('feature', { bead: 'zk-flow-x', skipReview: 'true', startAt: 'impl' });
  assert.match(cmd, /skipReview=true/);
  assert.match(cmd, /startAt=impl/);
});

// ---- claude argv / display --------------------------------------------------

test('buildHeadlessArgv uses -p (print) with --permission-mode by default — NO --headless / --max-turns', () => {
  const argv = buildHeadlessArgv('/feature autoApprove=true bead=zk-flow-x');
  assert.deepEqual(argv, ['-p', '--permission-mode', DEFAULT_PERMISSION_MODE, '/feature autoApprove=true bead=zk-flow-x']);
  assert.ok(!argv.includes('--headless'), 'must not emit --headless');
  assert.ok(!argv.includes('--max-turns'), 'must not emit --max-turns');
});

test('buildHeadlessArgv auto -> --dangerously-skip-permissions (unattended writes)', () => {
  const argv = buildHeadlessArgv('/bugfix bead=zk-flow-x', { auto: true });
  assert.deepEqual(argv, ['-p', '--dangerously-skip-permissions', '/bugfix bead=zk-flow-x']);
  assert.ok(!argv.includes('--permission-mode'), 'auto skips --permission-mode');
});

test('buildHeadlessArgv adds --model when given (after the permission flags)', () => {
  const withModel = buildHeadlessArgv('/bugfix bead=zk-flow-x', { model: 'opus-4.8' });
  assert.deepEqual(withModel, ['-p', '--permission-mode', DEFAULT_PERMISSION_MODE, '--model', 'opus-4.8', '/bugfix bead=zk-flow-x']);
  const autoModel = buildHeadlessArgv('/bugfix bead=zk-flow-x', { auto: true, model: 'opus-4.8' });
  assert.deepEqual(autoModel, ['-p', '--dangerously-skip-permissions', '--model', 'opus-4.8', '/bugfix bead=zk-flow-x']);
});

test('formatHeadlessCommand starts claude -p and quotes the slash command', () => {
  const s = formatHeadlessCommand('/feature autoApprove=true brief="x"');
  assert.match(s, /^claude -p --permission-mode acceptEdits "/);
  assert.doesNotMatch(s, /--headless|--max-turns/);
  const a = formatHeadlessCommand('/feature autoApprove=true brief="x"', { auto: true });
  assert.match(a, /^claude -p --dangerously-skip-permissions "/);
});

// ---- ProofOfWork extraction -------------------------------------------------

const POW = {
  bead: 'zk-flow-oauth', branch: 'zkflow/zk-flow-oauth', verdict: 'APPROVE', route: 'done',
  files_changed: ['src/a.js', 'src/b.js'], commits: ['abc123'], review: 'APPROVE',
  tests: { passed: 12, failed: 0 },
};
const COMMENTS = [
  'Research: {"synthesis":"..."}',
  'Design: {"sqca":"..."}',
  'GraderFeedback: {"phase":"design","verdict":"APPROVE"}',
  'Impl: {"files_changed":["src/a.js"]}',
  'ProofOfWork: ' + JSON.stringify(POW),
].join('\n');

test('extractProofOfWork pulls the ProofOfWork line out of bd comments', () => {
  const pow = extractProofOfWork(COMMENTS);
  assert.deepEqual(pow, POW);
});

test('extractProofOfWork returns the LAST ProofOfWork (re-run appends a fresh one)', () => {
  const second = { ...POW, verdict: 'REJECT', commits: ['def456'] };
  const text = COMMENTS + '\nProofOfWork: ' + JSON.stringify(second);
  assert.deepEqual(extractProofOfWork(text), second);
});

test('extractProofOfWork returns null when absent or malformed', () => {
  assert.equal(extractProofOfWork('Research: {"x":1}\nImpl: {"y":2}'), null);
  assert.equal(extractProofOfWork('ProofOfWork: {not json}'), null);
  assert.equal(extractProofOfWork(''), null);
  assert.equal(extractProofOfWork(undefined), null);
});

// ---- ProofOfWork -> receipt mapping -----------------------------------------

test('proofOfWorkToReceipt maps APPROVE -> done and surfaces schema fields', () => {
  const r = proofOfWorkToReceipt(POW, { taskId: 'T007', workflow: 'feature' }).goalbuddy_receipt_v1;
  assert.equal(r.result, 'done');
  assert.equal(r.task_id, 'T007');
  assert.deepEqual(r.changed_files, ['src/a.js', 'src/b.js']);
  assert.deepEqual(r.commits, ['abc123']);
  assert.equal(r.verdict, 'APPROVE');
  assert.deepEqual(r.tests, { passed: 12, failed: 0 });
  assert.match(r.summary, /zk-flow-oauth/);
});

test('proofOfWorkToReceipt maps non-APPROVE verdict -> blocked', () => {
  const r = proofOfWorkToReceipt({ ...POW, verdict: 'REJECT' }, { taskId: 'T007' }).goalbuddy_receipt_v1;
  assert.equal(r.result, 'blocked');
});

test('proofOfWorkToReceipt with no ProofOfWork -> blocked, empty arrays', () => {
  const r = proofOfWorkToReceipt(null, { taskId: 'T007' }).goalbuddy_receipt_v1;
  assert.equal(r.result, 'blocked');
  assert.deepEqual(r.changed_files, []);
  assert.deepEqual(r.commits, []);
  assert.match(r.summary, /no ProofOfWork/);
});

// ---- resolveReadBead --------------------------------------------------------

test('resolveReadBead normalizes the zk-flow- prefix and requires explicit bead', () => {
  assert.equal(resolveReadBead({ bead: 'zk-flow-x' }), 'zk-flow-x');
  assert.equal(resolveReadBead({ bead: 'login-bug' }), 'zk-flow-login-bug');
  assert.equal(resolveReadBead({ pr: 'https://x/pull/1' }), null); // must pass bead= for finish-pr
  assert.equal(resolveReadBead({}), null);
});

// ---- parseCliArgs -----------------------------------------------------------

test('parseCliArgs reads flags and key=value tokens', () => {
  const { flags, kv } = parseCliArgs(['--dry-run', 'workflow=feature', 'brief=add oauth']);
  assert.equal(flags.dryRun, true);
  assert.equal(kv.workflow, 'feature');
  assert.equal(kv.brief, 'add oauth');
});

test('parseCliArgs: --auto sets the unattended flag (default off)', () => {
  assert.equal(parseCliArgs([]).flags.auto, false);
  assert.equal(parseCliArgs(['--auto']).flags.auto, true);
});

// ---- runBridge orchestration (injected deps; no claude, no bd) --------------

// Injected bd-readiness probe stubs so runBridge tests never spawn real `bd`.
// BD_OK looks operational; BD_BROKEN reproduces the minions "no DB" output.
const BD_OK = () => '/repo/.beads\n  database: /repo/.beads/embeddeddolt';
const BD_BROKEN = () => 'Error: no beads database found\nHint: run \'bd init\'';

test('runBridge --help prints usage, runs nothing', () => {
  let logged = '';
  const res = runBridge(['--help'], { log: (s) => { logged += s; } });
  assert.equal(res.help, true);
  assert.match(logged, /goalbuddy-zkflow-run/);
});

test('runBridge --dry-run prints the claude -p command and never spawns claude or bd', () => {
  let logged = '';
  let spawned = false, readBd = false;
  const res = runBridge(['--dry-run', 'workflow=feature', 'brief=hello'], {
    log: (s) => { logged += s; },
    runHeadless: () => { spawned = true; },
    readBdComments: () => { readBd = true; return ''; },
    bdProbe: BD_OK,
    env: {},
  });
  assert.equal(res.dryRun, true);
  assert.match(logged, /claude -p --permission-mode acceptEdits "\/feature autoApprove=true/);
  assert.doesNotMatch(logged, /--headless|--max-turns/);
  assert.equal(spawned, false);
  assert.equal(readBd, false);
});

test('runBridge --dry-run --auto shows --dangerously-skip-permissions', () => {
  let logged = '';
  runBridge(['--dry-run', '--auto', 'workflow=feature', 'brief=hello'], {
    log: (s) => { logged += s + '\n'; },
    bdProbe: BD_OK,
    env: {},
  });
  assert.match(logged, /claude -p --dangerously-skip-permissions "\/feature autoApprove=true/);
});

test('runBridge end-to-end with mocked claude+bd yields a done receipt', () => {
  let ranArgv = null;
  const res = runBridge(['workflow=feature', 'bead=zk-flow-oauth', 'brief=add oauth', 'task_id=T007'], {
    env: { ZK_ARTIFACTS_DIR: '/tmp/zk-artifacts' },
    runHeadless: (argv) => { ranArgv = argv; },
    readBdComments: () => COMMENTS,
    bdProbe: BD_OK,
    log: () => {},
  });
  assert.equal(ranArgv[0], '-p');
  assert.ok(!ranArgv.includes('--headless') && !ranArgv.includes('--max-turns'));
  // real runs prepend the trailing non-interactive directive (slash stays FIRST)
  const prompt = ranArgv[ranArgv.length - 1];
  assert.match(prompt, /^\/feature autoApprove=true/, 'slash command MUST be at prompt position 0');
  assert.match(prompt, /do not ask for confirmation/);
  const r = res.receipt.goalbuddy_receipt_v1;
  assert.equal(r.result, 'done');
  assert.equal(r.task_id, 'T007');
  assert.deepEqual(r.changed_files, ['src/a.js', 'src/b.js']);
});

test('runBridge --auto threads --dangerously-skip-permissions into the spawned argv', () => {
  let ranArgv = null;
  runBridge(['--auto', 'workflow=bugfix', 'bead=zk-flow-x', 'brief=fix it'], {
    env: { ZK_ARTIFACTS_DIR: '/tmp/zk-artifacts' },
    runHeadless: (argv) => { ranArgv = argv; },
    readBdComments: () => COMMENTS,
    bdProbe: BD_OK,
    log: () => {},
  });
  assert.ok(ranArgv.includes('--dangerously-skip-permissions'));
  assert.ok(!ranArgv.includes('--permission-mode'));
});

test('runBridge fails safe when ZK_ARTIFACTS_DIR is unset (real execution path)', () => {
  assert.throws(
    () => runBridge(['workflow=feature', 'bead=zk-flow-x'], {
      env: {}, runHeadless: () => {}, readBdComments: () => COMMENTS, bdProbe: BD_OK, log: () => {},
    }),
    /ZK_ARTIFACTS_DIR is unset/,
  );
});

test('runBridge fails safe when no run bead can be resolved', () => {
  assert.throws(
    () => runBridge(['workflow=finish-pr', 'pr=https://github.com/o/r/pull/7'], {
      env: { ZK_ARTIFACTS_DIR: '/tmp/x' }, runHeadless: () => {}, readBdComments: () => COMMENTS, bdProbe: BD_OK, log: () => {},
    }),
    /cannot determine the run bead/,
  );
});

// ---- shell wrapper smoke (--dry-run / --help exit 0) ------------------------

test('shell wrapper --help exits 0 and prints usage', () => {
  const out = execFileSync('bash', [SCRIPT, '--help'], { encoding: 'utf8' });
  assert.match(out, /goalbuddy-zkflow-run/);
});

test('shell wrapper --dry-run prints the claude -p command and exits 0', () => {
  const out = execFileSync('bash', [SCRIPT, '--dry-run', 'workflow=feature', 'brief=hello'], { encoding: 'utf8' });
  assert.match(out, /claude -p --permission-mode acceptEdits "\/feature autoApprove=true/);
  assert.doesNotMatch(out, /--headless|--max-turns/);
});

test('shell wrapper --dry-run --auto shows --dangerously-skip-permissions and exits 0', () => {
  const out = execFileSync('bash', [SCRIPT, '--dry-run', '--auto', 'workflow=finish-pr', 'pr=40', 'bead=minions-pr40-finishpr', '--no-provision'], { encoding: 'utf8' });
  assert.match(out, /claude -p --dangerously-skip-permissions "\/finish-pr pr=40 bead=minions-pr40-finishpr"/);
});

test('finish-pr forwards bead= when provided (regression: ProofOfWork harvest correlation)', () => {
  const cmd = buildSlashCommand('finish-pr', { pr: '40', bead: 'minions-pr40-finishpr' });
  assert.equal(cmd, '/finish-pr pr=40 bead=minions-pr40-finishpr');
});

// ---- provisioning plan (pure; no FS) ----------------------------------------

const SRC = '/zk-flow';
const CWD = '/target/minions';

test('parseCliArgs: provision defaults ON, cleanup auto; flags flip them', () => {
  assert.equal(parseCliArgs([]).flags.provision, true);
  assert.equal(parseCliArgs([]).flags.cleanup, 'auto');
  assert.equal(parseCliArgs(['--no-provision']).flags.provision, false);
  assert.equal(parseCliArgs(['--no-cleanup']).flags.cleanup, false);
  assert.equal(parseCliArgs(['--cleanup']).flags.cleanup, true);
});

test('computeProvisionPlan: cwd already has workflows -> dirs no-op (needed=false)', () => {
  const probe = (p) => p === '/target/minions/.claude/workflows';
  // bd operational -> no bd init either; purely a no-op
  const plan = computeProvisionPlan({ cwd: CWD, sourceRoot: SRC, probe, bdReady: true, bead: 'b' });
  assert.equal(plan.needed, false);
  assert.equal(plan.bdInit, false);
  assert.match(formatProvisionPlan(plan), /already has \.claude\/workflows/);
});

test('computeProvisionPlan: cwd missing + bd broken -> copies, exclude, SANDBOX bd-init, local-only', () => {
  const probe = () => false; // nothing exists yet
  const plan = computeProvisionPlan({ cwd: CWD, sourceRoot: SRC, probe, bdReady: false, bead: 'minions-pr40' });
  assert.equal(plan.needed, true);
  assert.equal(plan.localOnly, true);
  // copies cover BOTH workflows and agents, from source root to cwd
  assert.deepEqual(plan.copies.map((c) => c.rel), PROVISION_DIRS);
  assert.deepEqual(plan.copies.map((c) => c.from),
    ['/zk-flow/.claude/workflows', '/zk-flow/.claude/agents']);
  assert.deepEqual(plan.copies.map((c) => c.to),
    ['/target/minions/.claude/workflows', '/target/minions/.claude/agents']);
  // exclude written to .git/info/exclude (NOT .gitignore), one line per dir
  assert.equal(plan.excludeFile, '/target/minions/.git/info/exclude');
  assert.deepEqual(plan.excludeLines, ['/.claude/workflows/', '/.claude/agents/']);
  // bd init runs LOCAL-ONLY into a SANDBOX (temp dir, NOT the target .beads)
  assert.equal(plan.bdInit, true);
  assert.ok(plan.bdInitArgs.includes('--stealth'));
  assert.ok(plan.bdInitArgs.includes('--non-interactive'));
  // sandbox MUST use the zk-flow prefix so the workflow's `zk-flow-<slug>` run
  // bead ids resolve (bd enforces the id prefix); otherwise harvest misses.
  const pfxIdx = plan.bdInitArgs.indexOf('--prefix');
  assert.ok(pfxIdx !== -1 && plan.bdInitArgs[pfxIdx + 1] === 'zk-flow', 'sandbox must init with --prefix zk-flow');
  assert.deepEqual(plan.bdConfig, [['backup.git-push', 'false']]);
  // sandbox dir is under the OS temp dir, keyed by the bead, and exposed via BEADS_DIR
  assert.match(plan.beadsDir, /gb-bridge-beads-minions-pr40[/\\]\.beads$/);
  assert.ok(!plan.beadsDir.startsWith('/target/minions'), 'sandbox must NOT live in the target repo');
  assert.deepEqual(plan.bdEnv, { BEADS_DIR: plan.beadsDir });
  // rendered plan asserts local-only and never mentions a push
  const txt = formatProvisionPlan(plan);
  assert.match(txt, /LOCAL-ONLY/);
  assert.match(txt, /never runs `bd dolt push`/);
  assert.match(txt, /NOT operational/);
  assert.match(txt, /BEADS_DIR=/);
  assert.doesNotMatch(txt, /\.gitignore/);
});

test('computeProvisionPlan: bd OPERATIONAL -> no bd init, no sandbox, no BEADS_DIR', () => {
  const probe = (p) => p === '/target/minions/.claude/workflows';
  const plan = computeProvisionPlan({ cwd: CWD, sourceRoot: SRC, probe, bdReady: true, bead: 'b' });
  assert.equal(plan.bdInit, false);
  assert.equal(plan.beadsDir, null);
  assert.equal(plan.bdEnv, null);
  assert.match(formatProvisionPlan(plan), /bd is operational/);
});

test('computeProvisionPlan: target has workflows but bd BROKEN -> dirs no-op, sandbox still planned', () => {
  const probe = (p) => p === '/target/minions/.claude/workflows';
  const plan = computeProvisionPlan({ cwd: CWD, sourceRoot: SRC, probe, bdReady: false, bead: 'b' });
  assert.equal(plan.needed, false, 'dirs already present');
  assert.equal(plan.bdInit, true, 'broken bd still requires a sandbox');
  assert.ok(plan.beadsDir);
});

test('resolveSourceRoot resolves the repo root one level above scripts/', () => {
  const scriptUrl = `file://${join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'goalbuddy-zkflow-run.mjs')}`;
  const root = resolveSourceRoot(scriptUrl);
  // the resolved root must actually contain the real .claude/workflows we copy from
  assert.ok(existsSync(join(root, '.claude', 'workflows')), `expected workflows under ${root}`);
});

// ---- applyProvision / cleanupProvision (mocked FS + bd) ---------------------

// Minimal in-memory FS double: tracks dir existence, file contents, and ops.
function makeFakeFs(preexisting = new Set()) {
  const dirs = new Set(preexisting);
  const files = new Map(); // path -> content
  const ops = [];
  return {
    fs: {
      existsSync: (p) => dirs.has(p) || files.has(p),
      mkdirSync: (p) => { dirs.add(p); ops.push(['mkdir', p]); },
      cpSync: (from, to) => { dirs.add(to); ops.push(['cp', from, to]); },
      rmSync: (p) => { dirs.delete(p); files.delete(p); ops.push(['rm', p]); },
      readFileSync: (p) => (files.has(p) ? files.get(p) : ''),
      writeFileSync: (p, c) => { files.set(p, c); ops.push(['write', p]); },
    },
    dirs, files, ops,
  };
}

test('applyProvision: no-op plan does nothing', () => {
  const { fs, ops } = makeFakeFs();
  const out = applyProvision({ needed: false }, { fs, runBd: () => { throw new Error('bd called'); } });
  assert.equal(out.needed, false);
  assert.equal(ops.length, 0);
});

test('applyProvision: copies dirs, excludes BEFORE copy, runs bd SANDBOX local-only, records what it created', () => {
  const probe = () => false;
  const plan = computeProvisionPlan({ cwd: CWD, sourceRoot: SRC, probe, bdReady: false, bead: 'b' });
  const { fs, ops } = makeFakeFs();
  const bdCalls = [];
  const prov = applyProvision(plan, { fs, runBd: (a, o) => bdCalls.push([a, o]) });

  // exclude write happens before any cp
  const firstWrite = ops.findIndex((o) => o[0] === 'write' && o[1] === plan.excludeFile);
  const firstCp = ops.findIndex((o) => o[0] === 'cp');
  assert.ok(firstWrite !== -1 && firstWrite < firstCp, 'exclude must be written before copy');
  // exclude file content has the two dir lines
  assert.match(fs.readFileSync(plan.excludeFile), /\/\.claude\/workflows\//);
  assert.match(fs.readFileSync(plan.excludeFile), /\/\.claude\/agents\//);
  // bd init local-only into the SANDBOX (BEADS_DIR set, cwd is the sandbox root,
  // NOT the target); backup.git-push false; NEVER a dolt push
  assert.ok(bdCalls.some(([a]) => a.includes('--stealth')));
  assert.ok(bdCalls.some(([a]) => a[0] === 'config' && a.includes('backup.git-push')));
  assert.ok(!bdCalls.some(([a]) => a.includes('dolt') || a.includes('push')), 'must never push dolt data');
  // every bd call carries BEADS_DIR and runs in the sandbox dir, never the target
  for (const [, o] of bdCalls) {
    assert.equal(o.env.BEADS_DIR, plan.beadsDir, 'bd must run with the sandbox BEADS_DIR');
    assert.ok(!String(o.cwd).startsWith('/target/minions'), 'bd must not run inside the target repo');
  }
  // recorded provisioned state for exact reversal
  assert.equal(prov.needed, true);
  assert.deepEqual(prov.appendedExcludeLines, ['/.claude/workflows/', '/.claude/agents/']);
  assert.deepEqual(prov.createdDirs, ['/target/minions/.claude/workflows', '/target/minions/.claude/agents']);
  assert.equal(prov.createdClaudeDir, true);
  assert.equal(prov.bdInit, true);
  assert.equal(prov.sandboxBeadsDir, plan.beadsDir);
  assert.deepEqual(prov.bdEnv, { BEADS_DIR: plan.beadsDir });
});

test('applyProvision: bd OPERATIONAL -> no bd calls, no sandbox recorded', () => {
  const probe = () => false;
  const plan = computeProvisionPlan({ cwd: CWD, sourceRoot: SRC, probe, bdReady: true, bead: 'b' });
  const { fs } = makeFakeFs();
  let bdCalled = false;
  const prov = applyProvision(plan, { fs, runBd: () => { bdCalled = true; } });
  assert.equal(bdCalled, false, 'operational bd must not be re-initialized');
  assert.equal(prov.bdInit, false);
  assert.equal(prov.sandboxBeadsDir, null);
});

test('applyProvision: target HAS workflows but bd broken -> only sandbox runs (no copies)', () => {
  const probe = (p) => p === '/target/minions/.claude/workflows';
  const plan = computeProvisionPlan({ cwd: CWD, sourceRoot: SRC, probe, bdReady: false, bead: 'b' });
  assert.equal(plan.needed, false);
  const { fs, ops } = makeFakeFs();
  const bdCalls = [];
  const prov = applyProvision(plan, { fs, runBd: (a, o) => bdCalls.push([a, o]) });
  assert.ok(!ops.some((o) => o[0] === 'cp'), 'no dir copies when dirs already present');
  assert.ok(bdCalls.some(([a]) => a.includes('--stealth')), 'sandbox bd still initialized');
  assert.equal(prov.bdInit, true);
  assert.ok(prov.sandboxBeadsDir);
});

test('applyProvision: only appends exclude lines that are not already present', () => {
  const probe = () => false;
  const plan = computeProvisionPlan({ cwd: CWD, sourceRoot: SRC, probe });
  const { fs } = makeFakeFs();
  fs.writeFileSync(plan.excludeFile, '/.claude/workflows/\n'); // one already there
  const prov = applyProvision(plan, { fs, runBd: () => {} });
  assert.deepEqual(prov.appendedExcludeLines, ['/.claude/agents/']);
});

test('computeCleanupPlan + cleanupProvision reverse EXACTLY what install added (incl temp sandbox)', () => {
  const probe = () => false;
  const plan = computeProvisionPlan({ cwd: CWD, sourceRoot: SRC, probe, bdReady: false, bead: 'b' });
  const { fs, ops } = makeFakeFs();
  // bd init materializes the sandbox on disk; reflect it so cleanup can remove it
  const prov = applyProvision(plan, { fs, runBd: (a) => { if (a[0] === 'init') fs.mkdirSync(plan.beadsDir); } });
  const sandboxRoot = dirname(plan.beadsDir);

  const clean = computeCleanupPlan(prov);
  assert.deepEqual(clean.removeDirs, prov.createdDirs);
  assert.deepEqual(clean.removeExcludeLines, prov.appendedExcludeLines);
  assert.equal(clean.removeClaudeDir, true);
  assert.equal(clean.removeSandboxRoot, sandboxRoot);

  ops.length = 0;
  // ensure the sandbox root exists in the FS double so cleanup's existsSync passes
  fs.mkdirSync(sandboxRoot);
  cleanupProvision(prov, { fs });
  // both created dirs removed
  assert.ok(ops.some((o) => o[0] === 'rm' && o[1] === '/target/minions/.claude/workflows'));
  assert.ok(ops.some((o) => o[0] === 'rm' && o[1] === '/target/minions/.claude/agents'));
  // .claude dir removed (it was created by this run)
  assert.ok(ops.some((o) => o[0] === 'rm' && o[1] === '/target/minions/.claude'));
  // the TEMP sandbox root removed (never the target's .beads)
  assert.ok(ops.some((o) => o[0] === 'rm' && o[1] === sandboxRoot));
  assert.ok(!ops.some((o) => o[0] === 'rm' && o[1] === '/target/minions/.beads'), 'must never touch the target .beads');
  // exclude file rewritten without the provisioned lines
  const left = fs.readFileSync(plan.excludeFile);
  assert.doesNotMatch(left, /\.claude\/workflows/);
  assert.doesNotMatch(left, /\.claude\/agents/);
});

test('cleanupProvision preserves a pre-existing exclude line not added by this run', () => {
  const probe = () => false;
  const plan = computeProvisionPlan({ cwd: CWD, sourceRoot: SRC, probe });
  const { fs } = makeFakeFs();
  fs.writeFileSync(plan.excludeFile, 'node_modules/\n/.claude/workflows/\n'); // pre-existing line + one provision line
  const prov = applyProvision(plan, { fs, runBd: () => {} });
  // only /.claude/agents/ was appended this run
  assert.deepEqual(prov.appendedExcludeLines, ['/.claude/agents/']);
  cleanupProvision(prov, { fs });
  const left = fs.readFileSync(plan.excludeFile);
  assert.match(left, /node_modules\//, 'pre-existing line must survive');
  assert.match(left, /\.claude\/workflows/, 'pre-existing provision line not added this run must survive');
  assert.doesNotMatch(left, /\.claude\/agents/, 'only this-run line removed');
});

test('cleanupProvision does NOT remove dirs that pre-existed install', () => {
  // .claude and workflows already exist; agents added this run
  const probe = (p) => p === '/target/minions/.beads'; // beads exists -> no bd init
  const plan = computeProvisionPlan({ cwd: CWD, sourceRoot: SRC, probe });
  // plan.needed is true only when workflows missing; force a mixed FS scenario
  const { fs, ops } = makeFakeFs(new Set(['/target/minions/.claude']));
  const plan2 = { ...plan, needed: true };
  const prov = applyProvision(plan2, { fs, runBd: () => {} });
  assert.equal(prov.createdClaudeDir, false, '.claude pre-existed -> not created');
  ops.length = 0;
  cleanupProvision(prov, { fs });
  assert.ok(!ops.some((o) => o[0] === 'rm' && o[1] === '/target/minions/.claude'),
    'must not remove a pre-existing .claude dir');
});

// ---- runBridge dry-run prints provisioning plan + does NO FS ops ------------

test('runBridge --dry-run prints provisioning plan and command, touches no FS', () => {
  let logged = '';
  let appliedFS = false;
  const res = runBridge(
    ['--dry-run', '--provision', 'workflow=finish-pr', 'pr=40', 'bead=minions-pr40-finishpr', `cwd=${CWD}`],
    {
      log: (s) => { logged += s + '\n'; },
      sourceRoot: SRC,
      probe: () => false, // target missing -> a real run WOULD provision
      applyProvision: () => { appliedFS = true; return { needed: true }; },
      cleanupProvision: () => { appliedFS = true; },
      runHeadless: () => { appliedFS = true; },
      readBdComments: () => { appliedFS = true; return ''; },
      bdProbe: BD_OK,
      env: {},
    },
  );
  assert.equal(res.dryRun, true);
  assert.equal(appliedFS, false, 'dry-run must not apply provisioning, run claude, or read bd');
  assert.match(logged, /provision plan/);
  assert.match(logged, /\.claude\/workflows/);
  assert.match(logged, /\.git\/info\/exclude/);
  assert.match(logged, /LOCAL-ONLY/);
  assert.match(logged, /claude -p --permission-mode acceptEdits "\/finish-pr pr=40 bead=minions-pr40-finishpr"/);
});

test('runBridge real run provisions then cleans up (auto), via injected orchestrators', () => {
  const calls = [];
  const res = runBridge(
    ['--provision', 'workflow=finish-pr', 'pr=40', 'bead=minions-pr40-finishpr', `cwd=${CWD}`],
    {
      log: () => {},
      sourceRoot: SRC,
      probe: () => false,
      env: { ZK_ARTIFACTS_DIR: '/tmp/x' },
      applyProvision: (p) => { calls.push('apply'); return { needed: true, cwd: CWD }; },
      cleanupProvision: () => { calls.push('cleanup'); },
      runHeadless: () => { calls.push('headless'); },
      readBdComments: () => COMMENTS,
      bdProbe: BD_OK,
    },
  );
  assert.deepEqual(calls, ['apply', 'headless', 'cleanup']);
  assert.equal(res.receipt.goalbuddy_receipt_v1.task_id, null);
});

test('runBridge --no-cleanup keeps provisioning in place', () => {
  const calls = [];
  runBridge(
    ['--provision', '--no-cleanup', 'workflow=finish-pr', 'pr=40', 'bead=minions-pr40-finishpr', `cwd=${CWD}`],
    {
      log: () => {},
      sourceRoot: SRC,
      probe: () => false,
      env: { ZK_ARTIFACTS_DIR: '/tmp/x' },
      applyProvision: () => { calls.push('apply'); return { needed: true, cwd: CWD }; },
      cleanupProvision: () => { calls.push('cleanup'); },
      runHeadless: () => { calls.push('headless'); },
      readBdComments: () => COMMENTS,
      bdProbe: BD_OK,
    },
  );
  assert.deepEqual(calls, ['apply', 'headless']); // no cleanup
});

test('runBridge --no-provision skips provisioning entirely (bd operational)', () => {
  const calls = [];
  runBridge(
    ['--no-provision', 'workflow=finish-pr', 'pr=40', 'bead=minions-pr40-finishpr', `cwd=${CWD}`],
    {
      log: () => {},
      sourceRoot: SRC,
      probe: () => false,
      env: { ZK_ARTIFACTS_DIR: '/tmp/x' },
      applyProvision: () => { calls.push('apply'); return { needed: true }; },
      cleanupProvision: () => { calls.push('cleanup'); },
      runHeadless: () => { calls.push('headless'); },
      readBdComments: () => COMMENTS,
      bdProbe: BD_OK,
    },
  );
  assert.deepEqual(calls, ['headless']);
});

// ---- bd-readiness detection + sandbox orchestration -------------------------

test('bdProbeSaysNotOperational detects the minions "no DB" markers', () => {
  assert.equal(bdProbeSaysNotOperational('Error: no beads database found\nHint: run \'bd init\''), true);
  assert.equal(bdProbeSaysNotOperational('Error: No active beads workspace found.'), true);
  assert.equal(bdProbeSaysNotOperational(''), true, 'empty/failed probe -> not operational');
  assert.equal(bdProbeSaysNotOperational(undefined), true);
  // operational: a resolved DB path, no markers
  assert.equal(bdProbeSaysNotOperational('/repo/.beads\n  database: /repo/.beads/embeddeddolt'), false);
});

test('sandboxBeadsDir lives under the OS temp dir, keyed+slugged by the bead', () => {
  const d = sandboxBeadsDir('minions/pr40 finishpr');
  assert.match(d, /gb-bridge-beads-minions-pr40-finishpr[/\\]\.beads$/);
  assert.ok(d.startsWith(tmpdir()), 'must live under the OS temp dir, never the target repo');
  assert.equal(sandboxBeadsDir(), join(tmpdir(), 'gb-bridge-beads-run', '.beads'));
});

test('withNonInteractiveDirective keeps the slash command at position 0', () => {
  const out = withNonInteractiveDirective('/bugfix bead=zk-flow-x');
  assert.match(out, /^\/bugfix bead=zk-flow-x /, 'slash MUST stay first (print-mode auto-exec requirement)');
  assert.match(out, /do not ask for confirmation/);
});

test('runBridge: bd BROKEN -> sandbox provisioned, BEADS_DIR threaded into claude AND harvest, cleaned up', () => {
  const calls = [];
  let headlessEnv = null;
  let harvestEnv = null;
  let appliedPlan = null;
  const res = runBridge(
    ['--no-provision', 'workflow=bugfix', 'bead=zk-flow-x', 'brief=fix the crash', `cwd=${CWD}`],
    {
      log: () => {},
      sourceRoot: SRC,
      probe: () => true, // dirs already present
      bdProbe: BD_BROKEN, // target bd is NOT operational
      env: { ZK_ARTIFACTS_DIR: '/tmp/x' },
      applyProvision: (plan) => {
        appliedPlan = plan;
        calls.push('apply');
        return { needed: false, bdInit: true, bdEnv: plan.bdEnv, sandboxBeadsDir: plan.beadsDir };
      },
      cleanupProvision: () => { calls.push('cleanup'); },
      runHeadless: (argv, o) => { calls.push('headless'); headlessEnv = o.env; },
      readBdComments: (bead, o) => { harvestEnv = o.env; return COMMENTS; },
    },
  );
  // sandbox required even under --no-provision because bd is broken
  assert.deepEqual(calls, ['apply', 'headless', 'cleanup']);
  assert.equal(appliedPlan.bdInit, true);
  assert.ok(appliedPlan.beadsDir.startsWith(tmpdir()));
  // BEADS_DIR threaded into BOTH the headless claude run and the harvest
  assert.deepEqual(headlessEnv, { BEADS_DIR: appliedPlan.beadsDir });
  assert.deepEqual(harvestEnv, { BEADS_DIR: appliedPlan.beadsDir });
  assert.equal(res.receipt.goalbuddy_receipt_v1.result, 'done');
});

test('runBridge: bd OPERATIONAL -> no sandbox, no BEADS_DIR override', () => {
  let headlessEnv = 'unset';
  let harvestEnv = 'unset';
  const calls = [];
  runBridge(
    ['--no-provision', 'workflow=bugfix', 'bead=zk-flow-x', 'brief=fix it', `cwd=${CWD}`],
    {
      log: () => {},
      sourceRoot: SRC,
      probe: () => true,
      bdProbe: BD_OK,
      env: { ZK_ARTIFACTS_DIR: '/tmp/x' },
      applyProvision: () => { calls.push('apply'); return { needed: false }; },
      cleanupProvision: () => { calls.push('cleanup'); },
      runHeadless: (argv, o) => { headlessEnv = o.env; },
      readBdComments: (bead, o) => { harvestEnv = o.env; return COMMENTS; },
    },
  );
  assert.deepEqual(calls, [], 'operational bd needs no provisioning at all');
  assert.equal(headlessEnv, null, 'no BEADS_DIR override when bd is operational');
  assert.equal(harvestEnv, null);
});
