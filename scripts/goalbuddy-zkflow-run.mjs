#!/usr/bin/env node
// scripts/goalbuddy-zkflow-run.mjs
// Option-A bridge: drive a zk-flow CORE workflow non-interactively from a
// GoalBuddy goal_worker task, then harvest the run's ProofOfWork bead as the
// receipt.
//
// A GoalBuddy task names a workflow + one input (bead=/brief=/pr=). This CLI
// maps that to the right slash-command (mirroring zkflow-daemon.sh: bug-shaped
// -> /debug, pr= -> /finish-pr, else /feature autoApprove=true), runs it via
// `claude -p` (print / non-interactive mode), reads back the ProofOfWork bead
// comment with `bd comments`, and emits a goalbuddy_receipt_v1 JSON to stdout.
//
// The pure logic (arg parsing, workflow selection, command build, ProofOfWork
// extraction, receipt shaping) is exported so it is unit-testable without ever
// invoking `claude` or a live bd DB. Only `main()` touches the process.
//
// Usage:
//   node scripts/goalbuddy-zkflow-run.mjs workflow=feature brief="add rate limiting"
//   node scripts/goalbuddy-zkflow-run.mjs workflow=bugfix bead=zk-flow-login-bug
//   node scripts/goalbuddy-zkflow-run.mjs workflow=finish-pr pr=https://github.com/o/r/pull/7
//   node scripts/goalbuddy-zkflow-run.mjs --dry-run workflow=feature brief="hello"
//   node scripts/goalbuddy-zkflow-run.mjs --help
//
// Flags: --dry-run (print the claude command, do not execute, exit 0),
//        --help (print usage, exit 0),
//        --auto (unattended: pass --dangerously-skip-permissions so writes do
//                not block on a permission prompt).
// Tuning keys: model (default inherits the session),
//              cwd (default process.cwd()), task_id (echoed into the receipt).

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import {
  existsSync, mkdirSync, cpSync, rmSync, readFileSync, writeFileSync,
} from 'node:fs';

// Default non-interactive permission mode when NOT running unattended. Writes
// still proceed (acceptEdits auto-accepts file edits) but the run stays in a
// supervised posture. Unattended runs (--auto) instead use
// --dangerously-skip-permissions (see buildHeadlessArgv).
export const DEFAULT_PERMISSION_MODE = 'acceptEdits';

// zk-flow's provisionable assets, relative to the repo root. /finish-pr (and
// every CORE workflow) only exists as a slash-command when the cwd has these.
export const PROVISION_DIRS = ['.claude/workflows', '.claude/agents'];

// Control keys this bridge understands on the CLI. workflow/cwd/task_id/model
// are bridge-level; bead/brief/pr/autoApprove/skipReview/startAt pass through
// into the zk-flow slash-command (they are CONTROL_KEYS in src/fragments/args.js,
// so the workflow parses them). max_turns is accepted-but-IGNORED (deprecated:
// the installed claude CLI has no --max-turns; see buildHeadlessArgv).
const BRIDGE_KEYS = new Set(['workflow', 'cwd', 'task_id', 'model']);

// ---------------------------------------------------------------------------
// Pure logic (no process, no spawn) — unit-tested.
// ---------------------------------------------------------------------------

// Parse `key=value` tokens and bare flags from an argv-style array.
// Quoted values are already de-quoted by the shell; we keep multi-word values
// that arrive as separate tokens joined under the last seen key only when the
// caller pre-joins them (the .sh wrapper quotes), so here a value is one token.
// provision defaults ON, cleanup defaults to "auto" (= cleanup after a real run,
// skipped for --dry-run). --no-provision / --no-cleanup turn them off; --cleanup
// forces it on even for inspection runs.
export function parseCliArgs(argv) {
  const out = { flags: { dryRun: false, help: false, provision: true, cleanup: 'auto', auto: false }, kv: {} };
  for (const tok of argv) {
    if (tok === '--dry-run') { out.flags.dryRun = true; continue; }
    if (tok === '--auto') { out.flags.auto = true; continue; }
    if (tok === '--help' || tok === '-h') { out.flags.help = true; continue; }
    if (tok === '--provision') { out.flags.provision = true; continue; }
    if (tok === '--no-provision') { out.flags.provision = false; continue; }
    if (tok === '--cleanup') { out.flags.cleanup = true; continue; }
    if (tok === '--no-cleanup') { out.flags.cleanup = false; continue; }
    const eq = tok.indexOf('=');
    if (eq > 0) {
      out.kv[tok.slice(0, eq)] = tok.slice(eq + 1);
    }
    // bare non-flag tokens are ignored (the workflow takes structured keys only)
  }
  return out;
}

// Heuristic mirror of zkflow-daemon.sh's plan_dispatch: treat a brief/title as
// bug-shaped when it reads like a defect. Only consulted when workflow=feature
// would otherwise be chosen AND no explicit workflow override forces it.
export function looksLikeBug(text) {
  return /\b(bug|fix|broken|regression|error|crash|fails?|failing|defect)\b/i.test(String(text || ''));
}

// bd-readiness detection (PURE). The bridge must NOT treat "a `.beads` dir
// exists" as "bd is operational" — a target repo (e.g. <org>/<repo>) can
// carry a `.beads` dir whose dolt DB was never materialized, so every `bd`
// command errors "no beads database found" and a hard-bd workflow (finish-pr)
// stops without a verdict. We instead inspect the OUTPUT of a cheap `bd where`
// (or `bd ready`) probe. bd prints these markers when no DB resolves:
//   - "no beads database found"
//   - "No active beads workspace found"
// (it also exits 0 in those cases, so we must parse text, not the exit code).
// Returns true when the probe output proves bd is NOT operational in that cwd.
const BD_NOT_OPERATIONAL_MARKERS = [
  /no beads database found/i,
  /No active beads workspace/i,
  /run 'bd init'/i,
];
export function bdProbeSaysNotOperational(probeOutput) {
  const text = String(probeOutput || '');
  if (!text.trim()) return true; // empty/failed probe -> assume not operational
  return BD_NOT_OPERATIONAL_MARKERS.some((re) => re.test(text));
}

// Sandbox beads dir for a run when the target's bd is broken/absent. LOCAL-ONLY:
// lives under the OS temp dir (never tracked by the target repo), keyed by the
// run bead so concurrent runs do not collide. The headless `claude` and the
// ProofOfWork harvest both run with BEADS_DIR pointed here, so beads persist
// into the sandbox and are read back from it — the target git remote never sees
// any refs/dolt/data.
export function sandboxBeadsDir(bead, root = tmpdir()) {
  const slug = String(bead || 'run').replace(/[^A-Za-z0-9._-]/g, '-');
  return join(root, `gb-bridge-beads-${slug}`, '.beads');
}

// Append an explicit non-interactive directive to a slash command, keeping the
// slash command as the FIRST characters of the prompt. Empirically (see
// docs/goalbuddy-integration.md) `claude -p "<slash> ..."` only auto-EXECUTES a
// workflow when the slash command is at prompt position 0; prepending natural
// language ("Run the following...: /wf") degrades it into a conversational
// prompt that merely *mentions* the command (it then defers / does a tangential
// action). A TRAILING directive is safe and hardens against a nested session
// inheriting an orchestrator's "ask before proceeding" posture.
export function withNonInteractiveDirective(slashCommand) {
  return `${slashCommand} (run now, non-interactively, to a terminal verdict; do not ask for confirmation or pause for approval)`;
}

// Decide the zk-flow workflow from the task inputs.
//   explicit workflow= wins (feature|small-feature|finish-pr|...). Legacy 'bugfix'
//     normalizes to 'debug' (bugs now route to the purpose-built debug workflow).
//   else: pr= -> finish-pr; bug-shaped brief -> debug; otherwise feature.
// Returns one of 'feature' | 'small-feature' | 'debug' | 'finish-pr' | ...
export function selectWorkflow({ workflow, pr, brief, bead } = {}) {
  if (workflow) {
    let w = String(workflow).toLowerCase();
    if (w === 'bugfix') w = 'debug'; // legacy alias: /bugfix was renamed; bugs -> /debug
    if (!['feature','small-feature','finish-pr','research','review','investigate','refactor','test','debug'].includes(w)) {
      throw new Error(`unknown workflow: ${workflow} (expected feature/small-feature/finish-pr/research/review/investigate/refactor/test/debug)`);
    }
    return w;
  }
  if (pr) return 'finish-pr';
  if (brief && looksLikeBug(brief)) return 'debug';
  if (bead && looksLikeBug(bead)) return 'debug';
  return 'feature';
}

// Build the zk-flow slash-command string for a workflow + inputs.
// feature MUST carry autoApprove=true so the design->impl seam chains in one
// unattended run (zkflow-daemon dispatches features the same way). small-feature,
// debug and finish-pr run to a terminal verdict in a single invocation (no design seam),
// so they need no autoApprove. bead= correlates the run + names the run bead we
// later read the ProofOfWork from.
export function buildSlashCommand(workflow, { bead, brief, pr, skipReview, startAt } = {}) {
  // small-feature was retired as a standalone workflow (was an orphan generated file with
  // no source) -- feature's profile=small replaces it, same lean lifecycle (no design panel,
  // no review council). Translate the emitted command only; `workflow` stays 'small-feature'
  // for the rest of this function so the no-autoApprove / bead-or-brief gating below is
  // unaffected.
  const isSmallFeature = workflow === 'small-feature';
  const parts = [`/${isSmallFeature ? 'feature' : workflow}`];
  if (isSmallFeature) parts.push('profile=small');
  if (workflow === 'feature') parts.push('autoApprove=true');
  if (workflow === 'finish-pr') {
    if (!pr) throw new Error('finish-pr requires pr=<url-or-number>');
    parts.push(`pr=${pr}`);
    if (bead) parts.push(`bead=${bead}`);
  } else {
    // feature / small-feature / debug: need a bead= (to read ProofOfWork back) or a brief.
    if (!bead && !brief) {
      throw new Error(`${workflow} requires bead=<id> or brief=<text>`);
    }
    if (bead) parts.push(`bead=${bead}`);
    if (brief) parts.push(`brief=${JSON.stringify(brief)}`);
  }
  if (startAt) parts.push(`startAt=${startAt}`);
  if (skipReview === true || skipReview === 'true') parts.push('skipReview=true');
  return parts.join(' ');
}

// Build the full argv for the installed `claude` CLI. Non-interactive runs use
// `-p/--print` (the ONLY supported non-interactive flag; there is NO --headless
// and NO --max-turns on this CLI). Permission control:
//   - auto/unattended  -> --dangerously-skip-permissions (writes never block on
//                         a permission prompt; required for an unattended run).
//   - otherwise        -> --permission-mode <DEFAULT_PERMISSION_MODE> (acceptEdits)
// model is optional and passed via --model when provided. The slash command is
// the trailing positional prompt. Returns an argv array (program-less).
// `directive=true` appends withNonInteractiveDirective() to the prompt (slash
// stays first). It is ON by default for real runs (hardens headless execution)
// and OFF for the dry-run command display unless requested.
export function buildHeadlessArgv(slashCommand, { model, auto = false, permissionMode, directive = false } = {}) {
  const argv = ['-p'];
  if (auto) {
    argv.push('--dangerously-skip-permissions');
  } else {
    argv.push('--permission-mode', String(permissionMode || DEFAULT_PERMISSION_MODE));
  }
  if (model) argv.push('--model', String(model));
  argv.push(directive ? withNonInteractiveDirective(slashCommand) : slashCommand);
  return argv;
}

// Human/shell display of the claude command (what --dry-run prints). Quotes only
// the trailing slash-command prompt; the rest are simple tokens.
export function formatHeadlessCommand(slashCommand, opts = {}) {
  const argv = buildHeadlessArgv(slashCommand, opts);
  return ['claude', ...argv.slice(0, -1), JSON.stringify(argv[argv.length - 1])].join(' ');
}

// ---------------------------------------------------------------------------
// Provisioning plan (pure) — decide what would be installed in a target repo so
// a zk-flow slash-workflow can run there, and how to undo it. NO FS ops here;
// the orchestrator (applyProvision/cleanupProvision) is the only thing that
// touches the disk. `probe` is an injectable predicate (path -> bool) so the
// plan is computed and unit-tested without reading the real filesystem.
//
// Iron law for target repos: NOTHING zk-flow provisions may end up committed or
// pushed to the target's remote. Two guarantees:
//   1. Provisioned dirs are added to <cwd>/.git/info/exclude (local, uncommitted
//      ignore) BEFORE they are copied — never the target's tracked .gitignore.
//   2. beads: the bridge detects whether bd is OPERATIONAL in the target cwd
//      (see bdProbeSaysNotOperational). If it is, the run uses the target's own
//      bd unchanged. If it is NOT (broken/unmaterialized/absent .beads), the
//      bridge spins up a LOCAL-ONLY SANDBOX bd under the OS temp dir
//      (sandboxBeadsDir) instead of touching the target: `bd init --stealth
//      --non-interactive` there, `backup.git-push false`, and BEADS_DIR points
//      at it for BOTH the headless `claude` run and the ProofOfWork harvest. The
//      bridge NEVER runs `bd dolt push` / adds a dolt remote, so the target git
//      remote (e.g. <org>/<repo>) never receives refs/dolt/data. The
//      sandbox dir is removed on cleanup.
//
// `bdReady` is the OPERATIONAL result of a cheap probe (bd where/ready), NOT the
// mere presence of a `.beads` dir. When bdReady is true the plan does no bd init
// and emits no BEADS_DIR override. When false it plans the temp sandbox.
//
// Returns a plan object:
//   {
//     needed: bool,                  // false => target already has workflows (no-op)
//     sourceRoot, targetClaudeDir,
//     copies: [{ from, to, rel }],   // dirs to copy (rel is the .git/info/exclude entry)
//     excludeFile, excludeLines,     // .git/info/exclude path + lines to append
//     bdInit: bool,                  // init a LOCAL-ONLY sandbox bd? (== !bdReady)
//     bdInitArgs, bdConfig,          // local-only init args + config to set
//     beadsDir,                      // sandbox .beads path (null when bd is operational)
//     bdEnv,                         // { BEADS_DIR } to inject into claude+harvest (null when operational)
//     localOnly: bool,               // always true (asserts the no-push guarantee)
//   }
export function computeProvisionPlan({ cwd, sourceRoot, probe = existsSync, bdReady = false, bead } = {}) {
  if (!cwd) throw new Error('computeProvisionPlan requires cwd');
  if (!sourceRoot) throw new Error('computeProvisionPlan requires sourceRoot');
  const targetClaudeDir = join(cwd, '.claude');
  const hasWorkflows = probe(join(cwd, '.claude', 'workflows'));

  const copies = PROVISION_DIRS.map((rel) => ({
    rel,
    from: join(sourceRoot, rel),
    to: join(cwd, rel),
  }));
  // exclude entries are repo-root-relative globs; trailing /** keeps the dir tree local.
  const excludeLines = PROVISION_DIRS.map((rel) => `/${rel}/`);
  const excludeFile = join(cwd, '.git', 'info', 'exclude');

  // bd init runs ONLY when bd is not operational in the target. It targets a
  // temp SANDBOX (never the target's .beads) via BEADS_DIR, so a broken target
  // .beads is bypassed rather than overwritten.
  const bdInit = !bdReady;
  const beadsDir = bdInit ? sandboxBeadsDir(bead) : null;
  const bdEnv = bdInit ? { BEADS_DIR: beadsDir } : null;

  return {
    needed: !hasWorkflows,
    sourceRoot,
    cwd,
    targetClaudeDir,
    copies,
    excludeFile,
    excludeLines,
    bdInit,
    beadsDir,
    bdEnv,
    // --prefix zk-flow is REQUIRED: zk-flow's runBeadId (src/fragments/bead-run.js)
    // derives every run bead as `zk-flow-<slug>` and the bd DB enforces that id
    // prefix. Without it the sandbox defaults its prefix to the temp dir name
    // (gb-bridge-beads-*), so the workflow's `zk-flow-*` writes/reads fail
    // ("prefix mismatch") — the exact harvest miss seen on the first proof run.
    // --stealth wires per-repo .git/info/exclude + invisible usage; embedded
    // dolt has no remote so it cannot auto-push; --non-interactive for headless.
    bdInitArgs: ['init', '--prefix', 'zk-flow', '--stealth', '--non-interactive'],
    // belt-and-suspenders: explicitly disable any backup git-push.
    bdConfig: [['backup.git-push', 'false']],
    localOnly: true,
  };
}

// Cleanup plan: reverse EXACTLY what applyProvision added, never pre-existing
// files. Derived purely from the install plan + what the install actually
// recorded (provisioned object from applyProvision). If install was a no-op
// (target already had workflows) the cleanup is also a no-op.
export function computeCleanupPlan(provisioned) {
  const empty = {
    removeDirs: [], excludeFile: null, removeExcludeLines: [], removeClaudeDir: false, removeSandboxRoot: null,
  };
  if (!provisioned) return empty;
  // The sandbox bd lives outside the target (OS temp dir); it is removed whenever
  // this run created it, INDEPENDENT of whether .claude dirs were provisioned.
  const removeSandboxRoot = provisioned.sandboxBeadsDir
    ? dirname(provisioned.sandboxBeadsDir) // remove the whole gb-bridge-beads-<bead> dir
    : null;
  if (!provisioned.needed) {
    return { ...empty, removeSandboxRoot };
  }
  return {
    // only the dirs THIS run created (not ones that already existed)
    removeDirs: (provisioned.createdDirs || []).slice(),
    excludeFile: provisioned.excludeFile || null,
    // only the exclude lines THIS run appended
    removeExcludeLines: (provisioned.appendedExcludeLines || []).slice(),
    // remove the .claude dir only if this run created it (it was absent before)
    removeClaudeDir: !!provisioned.createdClaudeDir,
    // remove the temp sandbox bd this run created (never the target's .beads)
    removeSandboxRoot,
  };
}

// Render a provisioning plan as the text printed by --dry-run.
export function formatProvisionPlan(plan) {
  const lines = ['provision plan (LOCAL-ONLY — nothing committed/pushed to the target remote):'];
  if (!plan.needed) {
    lines.push('  dirs: target already has .claude/workflows — no copy needed');
  } else {
    for (const c of plan.copies) lines.push(`  copy  ${c.from}  ->  ${c.to}`);
    lines.push(`  exclude ${plan.excludeFile} += ${plan.excludeLines.join(' , ')}`);
  }
  if (plan.bdInit) {
    lines.push(`  bd: target bd NOT operational — sandbox at ${plan.beadsDir}`);
    lines.push(`  bd ${plan.bdInitArgs.join(' ')}   (BEADS_DIR=${plan.beadsDir})`);
    for (const [k, v] of plan.bdConfig) lines.push(`  bd config set ${k} ${v}   (no refs/dolt/data push)`);
    lines.push(`  claude + harvest run with BEADS_DIR=${plan.beadsDir}`);
  } else {
    lines.push('  bd: target bd is operational — used as-is (no init, no override)');
  }
  lines.push('  local-only: bridge never runs `bd dolt push` / adds a dolt remote');
  return lines.join('\n');
}

// Extract the ProofOfWork payload from `bd comments <bead>` text. Comments are
// written as "<Type>: <json>" (see src/fragments/bd-memory.js bdWrite). We scan
// for the LAST `ProofOfWork:` line (a re-run appends a fresh one) and JSON-parse
// the remainder of that line. Returns the parsed object or null if none/invalid.
export function extractProofOfWork(commentsText) {
  if (!commentsText || typeof commentsText !== 'string') return null;
  let found = null;
  for (const raw of commentsText.split('\n')) {
    const idx = raw.indexOf('ProofOfWork:');
    if (idx === -1) continue;
    const json = raw.slice(idx + 'ProofOfWork:'.length).trim();
    try {
      const parsed = JSON.parse(json);
      if (parsed && typeof parsed === 'object') found = parsed;
    } catch (_) { /* skip malformed line; keep last good */ }
  }
  return found;
}

// Map a ProofOfWork bead payload -> goalbuddy_receipt_v1. The ProofOfWork schema
// (src/fragments/bead-run.js buildProofOfWork) carries:
//   {bead, branch, verdict, route, files_changed, commits, review, tests}
// We surface the acceptance-relevant fields. result=done iff verdict APPROVE.
export function proofOfWorkToReceipt(pow, { taskId = null, workflow = null } = {}) {
  if (!pow) {
    return {
      goalbuddy_receipt_v1: {
        result: 'blocked',
        task_id: taskId,
        changed_files: [],
        commits: [],
        verdict: null,
        tests: null,
        summary: 'no ProofOfWork bead found for this run (workflow may not have completed)',
      },
    };
  }
  const verdict = pow.verdict || null;
  const approved = String(verdict).toUpperCase() === 'APPROVE';
  const files = pow.files_changed || [];
  const commits = pow.commits || [];
  return {
    goalbuddy_receipt_v1: {
      result: approved ? 'done' : 'blocked',
      task_id: taskId,
      changed_files: files,
      commits,
      verdict,
      tests: pow.tests ?? null,
      summary: `${workflow || 'zk-flow'} run on bead ${pow.bead || '?'} -> ${verdict || 'no verdict'}`
        + ` (branch ${pow.branch || '?'}, ${files.length} file(s), ${commits.length} commit(s), review ${pow.review || 'n/a'})`,
    },
  };
}

export const USAGE = `goalbuddy-zkflow-run — drive a zk-flow workflow non-interactively (claude -p) and harvest its ProofOfWork receipt

Usage:
  goalbuddy-zkflow-run.mjs workflow=<feature|small-feature|debug|finish-pr> <bead=ID | brief=TEXT | pr=URL> [opts]

Inputs (one of):
  bead=<id>      run bead id (also lets the bridge read the ProofOfWork back)
  brief=<text>   free-text task brief (feature/small-feature/debug)
  pr=<url|num>   PR to finish (finish-pr)

Options:
  workflow=<w>   feature | bugfix | finish-pr (default: inferred from inputs)
  model=<m>      model override (default: inherit session; all tiers are opus 4.8)
  cwd=<path>     repo to run in (default: current dir)
  task_id=<id>   GoalBuddy task id, echoed into the receipt
  max_turns=<n>  DEPRECATED, accepted-but-ignored (the installed claude CLI has
                 no --max-turns flag; nothing is emitted for it)
  --auto         unattended: pass --dangerously-skip-permissions so file writes
                 do not block on a permission prompt. Without it the run uses
                 --permission-mode ${DEFAULT_PERMISSION_MODE}.
  --provision    (default ON) transiently install zk-flow's .claude/workflows +
                 .claude/agents into the target cwd if missing, LOCAL-ONLY:
                 dirs are added to .git/info/exclude before copying and beads,
                 if initialized, runs sandbox (no refs/dolt/data push to the
                 target remote). Never touches the target's tracked .gitignore.
  --no-provision assume the target already has .claude/workflows; install nothing
  --cleanup      (default ON after a real run) remove ONLY what provisioning
                 added, restoring the target repo as found
  --no-cleanup   leave the provisioned files in place after the run
  --dry-run      print the provisioning PLAN + the headless command, exit 0,
                 touch nothing (cleanup is skipped; no FS ops)
  --help, -h     print this help and exit 0

Mapping: feature gets autoApprove=true (chains design->impl unattended); bugfix
and finish-pr run to a terminal verdict in one invocation. On completion the run
bead's ProofOfWork comment ({bead,branch,verdict,route,files_changed,commits,
review,tests}) is read via 'bd comments' and shaped into goalbuddy_receipt_v1.`;

// ---------------------------------------------------------------------------
// Side-effecting helpers (spawn claude / read bd). Injected in tests.
// ---------------------------------------------------------------------------

// Resolve zk-flow's repo root from this script's own location. scripts/ is one
// level under the repo root (scripts/goalbuddy-zkflow-run.mjs -> repo root).
export function resolveSourceRoot(metaUrl = import.meta.url) {
  return resolve(dirname(fileURLToPath(metaUrl)), '..');
}

function defaultRunBd(argv, { cwd, env } = {}) {
  execFileSync('bd', argv, { stdio: 'inherit', cwd, env: env ? { ...process.env, ...env } : process.env });
}

// Apply a provisioning plan to the FS. Returns a `provisioned` record capturing
// EXACTLY what was created so cleanup can reverse only that. All FS/bd calls go
// through injected deps so tests never touch disk or spawn bd.
export function applyProvision(plan, deps = {}) {
  const fs = deps.fs || {
    existsSync, mkdirSync, cpSync, readFileSync, writeFileSync, rmSync,
  };
  const runBd = deps.runBd || defaultRunBd;
  const log = deps.log || (() => {});

  let createdClaudeDir = false;
  let createdDirs = [];
  let appendedExcludeLines = [];

  // ---- dir provisioning (only when the target lacks .claude/workflows) -------
  if (plan.needed) {
    createdClaudeDir = !fs.existsSync(plan.targetClaudeDir);

    // 1. exclude FIRST (before copying) so nothing is ever stageable in the window.
    const existing = fs.existsSync(plan.excludeFile) ? fs.readFileSync(plan.excludeFile, 'utf8') : '';
    const have = new Set(existing.split('\n').map((s) => s.trim()));
    appendedExcludeLines = plan.excludeLines.filter((l) => !have.has(l.trim()));
    if (appendedExcludeLines.length) {
      const sep = existing && !existing.endsWith('\n') ? '\n' : '';
      try { fs.mkdirSync(plan.excludeFile.substring(0, plan.excludeFile.lastIndexOf('/')), { recursive: true }); } catch (e) {}
      fs.writeFileSync(plan.excludeFile, existing + sep + appendedExcludeLines.join('\n') + '\n');
      log(`provision: appended ${appendedExcludeLines.length} line(s) to ${plan.excludeFile}`);
    }

    // 2. copy the workflow + agent dirs.
    fs.mkdirSync(plan.targetClaudeDir, { recursive: true });
    for (const c of plan.copies) {
      if (!fs.existsSync(c.to)) createdDirs.push(c.to);
      fs.cpSync(c.from, c.to, { recursive: true });
      log(`provision: copied ${c.from} -> ${c.to}`);
    }
  }

  // ---- bd SANDBOX (only when the target's bd is NOT operational) -------------
  // Runs regardless of whether dirs were provisioned: a target can have
  // workflows but a broken/absent bd DB. The sandbox lives in the OS temp dir
  // (NOT the target's .beads) and is reached via BEADS_DIR for init+config; the
  // same BEADS_DIR is later threaded into the claude run and the harvest.
  let sandboxBeadsDir = null;
  if (plan.bdInit) {
    sandboxBeadsDir = plan.beadsDir;
    const sandboxCwd = dirname(sandboxBeadsDir); // .../gb-bridge-beads-<bead>
    fs.mkdirSync(sandboxCwd, { recursive: true });
    const env = plan.bdEnv;
    runBd(plan.bdInitArgs, { cwd: sandboxCwd, env });
    for (const [k, v] of plan.bdConfig) runBd(['config', 'set', k, v], { cwd: sandboxCwd, env });
    log(`provision: bd SANDBOX initialized LOCAL-ONLY at ${sandboxBeadsDir} (no remote sync; target bd untouched)`);
  }

  return {
    needed: plan.needed,
    cwd: plan.cwd,
    excludeFile: plan.excludeFile,
    appendedExcludeLines,
    createdDirs,
    createdClaudeDir,
    bdInit: plan.bdInit,
    sandboxBeadsDir,
    bdEnv: plan.bdEnv || null,
  };
}

// Reverse a provisioning, removing ONLY what applyProvision created.
export function cleanupProvision(provisioned, deps = {}) {
  const fs = deps.fs || { existsSync, rmSync, readFileSync, writeFileSync };
  const log = deps.log || (() => {});
  const plan = computeCleanupPlan(provisioned);

  for (const dir of plan.removeDirs) {
    if (fs.existsSync(dir)) { fs.rmSync(dir, { recursive: true, force: true }); log(`cleanup: removed ${dir}`); }
  }
  if (plan.removeClaudeDir && provisioned.cwd) {
    const claudeDir = join(provisioned.cwd, '.claude');
    if (fs.existsSync(claudeDir)) { fs.rmSync(claudeDir, { recursive: true, force: true }); log(`cleanup: removed ${claudeDir}`); }
  }
  if (plan.removeSandboxRoot && fs.existsSync(plan.removeSandboxRoot)) {
    fs.rmSync(plan.removeSandboxRoot, { recursive: true, force: true });
    log(`cleanup: removed bd sandbox ${plan.removeSandboxRoot}`);
  }
  if (plan.excludeFile && plan.removeExcludeLines.length && fs.existsSync(plan.excludeFile)) {
    const drop = new Set(plan.removeExcludeLines.map((s) => s.trim()));
    const kept = fs.readFileSync(plan.excludeFile, 'utf8')
      .split('\n')
      .filter((l) => !drop.has(l.trim()));
    fs.writeFileSync(plan.excludeFile, kept.join('\n'));
    log(`cleanup: removed ${plan.removeExcludeLines.length} provisioned line(s) from ${plan.excludeFile}`);
  }
}

function defaultRunHeadless(argv, { cwd, env } = {}) {
  execFileSync('claude', argv, { stdio: 'inherit', cwd, env: env ? { ...process.env, ...env } : process.env });
}

function defaultReadBdComments(bead, { cwd, env } = {}) {
  return execFileSync('bd', ['comments', bead], {
    encoding: 'utf8', cwd, env: env ? { ...process.env, ...env } : process.env,
  });
}

// Probe whether bd is operational in `cwd` by running a cheap `bd where` and
// inspecting its OUTPUT (not exit code — bd exits 0 even when no DB resolves).
// Injectable so tests never spawn bd. Returns true when bd resolves a real DB.
function defaultBdProbe(cwd) {
  let out = '';
  try {
    out = execFileSync('bd', ['where'], { encoding: 'utf8', cwd, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    out = String((e && (e.stdout || e.stderr)) || '');
  }
  return out;
}

// Resolve the run bead id we should read ProofOfWork from. For finish-pr the run
// bead is derived as zk-flow-pr-<slug> (src/fragments/bead-run.js runBeadId), so
// the caller should pass bead= explicitly to harvest a finish-pr receipt; we
// surface a clear error otherwise rather than guessing the slug.
export function resolveReadBead({ bead, pr } = {}) {
  if (bead) return bead.startsWith('zk-flow-') ? bead : 'zk-flow-' + bead;
  if (pr) return null; // unknown without re-deriving the slug; require explicit bead=
  return null;
}

// Orchestrate one bridge run. Pure-ish: all I/O goes through injected deps so
// tests can drive it with no claude/bd. Returns { receipt, command }.
export function runBridge(argv, deps = {}) {
  const runHeadless = deps.runHeadless || defaultRunHeadless;
  const readBdComments = deps.readBdComments || defaultReadBdComments;
  const log = deps.log || ((s) => process.stdout.write(s + '\n'));
  const env = deps.env || process.env;
  const applyProvisionFn = deps.applyProvision || applyProvision;
  const cleanupProvisionFn = deps.cleanupProvision || cleanupProvision;
  const sourceRoot = deps.sourceRoot || resolveSourceRoot();

  const { flags, kv } = parseCliArgs(argv);
  if (flags.help) { log(USAGE); return { help: true, command: null, receipt: null }; }

  const workflow = selectWorkflow(kv);
  const inputs = { bead: kv.bead, brief: kv.brief, pr: kv.pr, skipReview: kv.skipReview, startAt: kv.startAt };
  const slash = buildSlashCommand(workflow, inputs);
  const model = kv.model;
  const auto = !!flags.auto;
  const cwd = kv.cwd || (deps.cwd) || process.cwd();
  const taskId = kv.task_id || null;
  // Real runs prepend a trailing non-interactive directive (slash stays first)
  // to harden headless execution; the dry-run command display shows the bare
  // slash for readability.
  const argvHeadless = buildHeadlessArgv(slash, { model, auto, directive: true });
  const command = formatHeadlessCommand(slash, { model, auto });

  // bd-readiness probe. The plan key off whether bd is OPERATIONAL in cwd, not
  // whether a `.beads` dir exists. The bead id keys the sandbox dir.
  const bdProbe = deps.bdProbe || defaultBdProbe;
  const probe = deps.probe || existsSync;
  const bead = inputs.bead || inputs.pr || workflow;

  // Always probe bd readiness (cheap `bd where`) — the sandbox must kick in
  // when bd is broken even under --no-provision.
  const bdReady = !bdProbeSaysNotOperational(bdProbe(cwd));

  // Provisioning plan (computed for both dry-run and real runs).
  const plan = flags.provision
    ? computeProvisionPlan({ cwd, sourceRoot, probe, bdReady, bead })
    : computeProvisionPlan({ cwd, sourceRoot, probe: () => true, bdReady, bead });

  if (flags.dryRun) {
    if (flags.provision) log(formatProvisionPlan(plan));
    else log('provision: disabled (--no-provision) — assuming target already has .claude/workflows');
    if (!bdReady) log(`bd: target bd NOT operational (probe) — would sandbox at ${plan.beadsDir}`);
    log(command);
    return { dryRun: true, command, receipt: null, workflow, plan, bdReady };
  }

  // Fail-safe preconditions (only when actually executing).
  if (!env.ZK_ARTIFACTS_DIR) {
    throw new Error('ZK_ARTIFACTS_DIR is unset — zk-flow needs it for skills/vault; refusing to run');
  }
  const readBead = resolveReadBead(inputs);
  if (!readBead) {
    throw new Error('cannot determine the run bead to harvest ProofOfWork from — pass bead=<id> '
      + '(finish-pr/brief-only runs derive their own bead id; supply it explicitly)');
  }

  // --cleanup defaults to "auto" (cleanup after a real run); explicit --no-cleanup keeps it.
  const doCleanup = flags.cleanup === false ? false : true;
  let provisioned = { needed: false };

  // Apply provisioning when either the dirs are missing (flags.provision) OR a
  // bd sandbox is required (target bd not operational). The sandbox is set up
  // even when dirs already exist (target has workflows but a broken .beads).
  const mustProvision = (flags.provision && plan.needed) || plan.bdInit;

  try {
    if (mustProvision) {
      provisioned = applyProvisionFn(plan, { log });
    }

    // Thread the sandbox BEADS_DIR (if any) into BOTH the headless claude run
    // and the harvest, so the workflow persists beads into the sandbox and we
    // read the ProofOfWork back from the SAME sandbox. When bd is operational
    // bdEnv is null and the target's own bd is used.
    const bdEnv = provisioned.bdEnv || (plan.bdInit ? plan.bdEnv : null);

    runHeadless(argvHeadless, { cwd, env: bdEnv });

    let comments;
    try {
      comments = readBdComments(readBead, { cwd, env: bdEnv });
    } catch (e) {
      throw new Error(`failed to read 'bd comments ${readBead}': ${e.message} (is bd installed and the bead present?)`);
    }
    const pow = extractProofOfWork(comments);
    const receipt = proofOfWorkToReceipt(pow, { taskId, workflow });
    return { command, receipt, workflow, readBead, provisioned, bdReady };
  } finally {
    if (doCleanup && (provisioned.needed || provisioned.bdInit)) {
      try { cleanupProvisionFn(provisioned, { log }); }
      catch (e) { log(`cleanup: WARNING failed to fully revert provisioning: ${e.message}`); }
    }
  }
}

// ---------------------------------------------------------------------------
// CLI entry
// ---------------------------------------------------------------------------

export function main(argv = process.argv.slice(2)) {
  try {
    const res = runBridge(argv);
    if (res.help || res.dryRun) return 0;
    process.stdout.write(JSON.stringify(res.receipt, null, 2) + '\n');
    return res.receipt.goalbuddy_receipt_v1.result === 'done' ? 0 : 1;
  } catch (e) {
    process.stderr.write(`goalbuddy-zkflow-run: ${e.message}\n`);
    return 2;
  }
}

// Run when invoked directly (not when imported by tests).
if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main());
}
