// tests/vault-sync.test.js
// Contract + guardrail checks for the /vault-sync repo->vault note workflow.
// The dangerous bits are (a) it is the only workflow that writes vault notes and
// (b) it reads a repo it must never mutate, so the path guard, the read-only repo
// rule, and the JS-side marker key all get asserted against the built bundle.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildWorkflow, fragmentsFor } from '../build.js';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

const out = buildWorkflow('vault-sync', fragmentsFor('vault-sync'));

test('vault-sync: builds self-contained (meta, no marker, no imports)', () => {
  assert.ok(out.includes("name: 'vault-sync'"), "meta name 'vault-sync'");
  assert.ok(!out.includes('// @@FRAGMENTS@@'), 'no leftover @@FRAGMENTS@@ marker');
  assert.ok(!/^import\s/m.test(out), 'no import statements survive into the bundle');
});

test('vault-sync: four declared phases match the phase() calls', () => {
  for (const p of ['Scope', 'Scan', 'Diff', 'Write']) {
    assert.ok(out.includes(`{ title: '${p}' }`), `meta declares ${p}`);
    assert.ok(out.includes(`phase('${p}')`), `phase('${p}') called`);
  }
});

test('vault-sync: P0 — note writes are constrained to vault/**.md in JS, not just the prompt', () => {
  assert.ok(/e\.path\.startsWith\('vault\/'\)/.test(out), 'vault/ prefix enforced');
  assert.ok(/e\.path\.endsWith\('\.md'\)/.test(out), '.md suffix enforced');
  assert.ok(/e\.path\.includes\('\.\.'\)/.test(out), 'parent-dir escape rejected');
  assert.ok(/rejectedEdits/.test(out), 'rejected edits are counted, not silently dropped');
  assert.ok(/rejectedReasons\.push/.test(out), 'each rejection records why');
});

test('vault-sync: P0 — the source repo is declared read-only for the scan agent', () => {
  assert.ok(/NEVER checkout, reset, commit, push, or edit any file there/.test(out),
    'scan phase forbids mutating the target repo');
  assert.ok(/Do NOT touch the source repo/.test(out), 'write phase forbids touching the repo');
});

test('vault-sync: P1 — bd marker key is derived in JS from the repo arg only', () => {
  assert.ok(/const markerKey = 'vault-sync-marker-'/.test(out), 'namespaced marker key');
  assert.ok(/replace\(\/\[\^a-z0-9\]\+\/g, '-'\)/.test(out), 'kebab sanitizer present');
  // The marker command must be precomputed in JS so agent output cannot retarget a key.
  assert.ok(/const markerCommand = bdRemember\(/.test(out), 'marker command precomputed');
  assert.ok(/run EXACTLY this, unedited/.test(out), 'agent told not to edit the command');
});

test('vault-sync: P1 — empty scan and empty plan short-circuit before any write', () => {
  assert.ok(/changes\.length === 0/.test(out), 'empty scan returns early');
  assert.ok(/safeEdits\.length === 0/.test(out), 'empty plan returns early');
  const writeIdx = out.indexOf("phase('Write')");
  assert.ok(out.indexOf('changes.length === 0') < writeIdx, 'scan guard precedes Write');
  assert.ok(out.indexOf('safeEdits.length === 0') < writeIdx, 'plan guard precedes Write');
});

test('vault-sync: dryRun plans without writing', () => {
  assert.ok(/_dryRunArg === 'true'/.test(out), 'dryRun arg parsed (through the salvage-aware picker)');
  assert.ok(/vault_sync_dry_run/.test(out), 'dry-run verdict exists');
  assert.ok(out.indexOf('vault_sync_dry_run') < out.indexOf("phase('Write')"), 'dry run returns before Write');
});

test('vault-sync: skills reach the note-writing phase', () => {
  assert.ok(/selectAndRenderSkills\(/.test(out), 'skills selected for the plan phase');
  assert.ok(/function selectAndRenderSkills/.test(out), 'skill-render fragment inlined');
});

test('vault-sync: skill contradictions are surfaced, never applied', () => {
  assert.ok(/skill_drift/.test(out), 'skill_drift channel exists');
  assert.ok(/do NOT propose skill edits here/.test(out), 'skill mutation stays with /improve');
});

test('vault-sync: env + bd preflights fail closed before the repo is touched', () => {
  assert.ok(/requireZkArtifacts\(\)/.test(out), 'ZK_ARTIFACTS_DIR guarded');
  assert.ok(/SKILLS_PREFLIGHT_PROMPT/.test(out), 'deferred env check runs agent-side');
  assert.ok(/BD_PREFLIGHT_PROMPT/.test(out), 'bd guarded');
  assert.ok(out.indexOf('BD_PREFLIGHT_PROMPT') < out.indexOf("phase('Scope')"), 'preflights precede Scope');
});

test('vault-sync: maxNotes is capped', () => {
  assert.ok(/Math\.min\(Number\(_pick\('maxNotes'\)\) \|\| 6, 12\)/.test(out), 'maxNotes bounded to 12');
});

test('vault-sync: P0 — the plan is graded before anything is written', () => {
  // /vault-sync is the only workflow that writes vault notes and had no gate at all,
  // while every other writing workflow is grade-gated.
  assert.ok(/phase\('Grade'\)/.test(out), 'Grade phase exists');
  assert.ok(/vault-note-rubric\.md/.test(out), 'grades against the vault-note rubric');
  assert.ok(/agentType: 'grader'/.test(out), 'uses the grader agent');
  const gradeIdx = out.indexOf("phase('Grade')");
  const writeIdx = out.indexOf("phase('Write')");
  assert.ok(gradeIdx > 0 && gradeIdx < writeIdx, 'Grade runs before Write');
  assert.ok(/vault_sync_rejected/.test(out), 'a non-APPROVE plan returns rejected');
  assert.ok(out.indexOf('vault_sync_rejected') < writeIdx, 'rejection returns before Write');
});

test('vault-sync: the grader gate precedes the dryRun return', () => {
  // A dry run that skipped grading would preview an unvetted plan — the opposite of useful.
  assert.ok(out.indexOf('vault_sync_rejected') < out.indexOf('vault_sync_dry_run'),
    'grade gate evaluated before the dry-run exit');
  assert.ok(/grade: gradeVerdict/.test(out), 'the verdict is reported in the result');
});

test('vault-sync: grader findings are non-empty when it rejects', () => {
  assert.ok(/assertFindings\(gradeOut/.test(out),
    'assertFindings guards against a REQUEST_CHANGES/BLOCK with no findings');
});

test('vault-sync: the grade verdict cannot arrive without a reason', () => {
  // The first real write run rejected all 3 repos and reported "BLOCK" with an EMPTY
  // summary and no findings anywhere in the result. Cause: the grade agent validated
  // against SCHEMAS.review, whose shape is code-review (severity/file/autofix_class/owner)
  // and whose properties do not include `summary` — so every rejection reason was stripped
  // by schema validation. A gate you cannot read is not a gate.
  assert.ok(/SCHEMAS\['vault-note-review'\]/.test(out), 'uses the purpose-built schema');
  assert.ok(!/schema: SCHEMAS\.review, agentType: 'grader'/.test(out), 'not review.json');
  assert.ok(/findings: r\.findings \|\| \[\]/.test(out), 'per-repo findings survive aggregation');
  assert.ok(/grade: r\.grade \|\| null/.test(out), 'per-repo verdict survives aggregation');
  assert.ok(/grader returned no summary and no findings/.test(out),
    'an unexplained verdict says so instead of printing an empty string');
});

test('vault-sync: the grade prompt overrides the grader agent default contract', () => {
  // The grader agent's own Output contract section said "emit review.json". That system
  // prompt beat the per-call schema: /vault-sync passed vault-note-review.json and got
  // review.json-shaped findings with `summary` dropped, so three rejections reached the
  // operator unreadable. Passing `schema:` alone was not enough.
  assert.ok(/NOT review\.json/.test(out), 'prompt names the schema and excludes review.json');
  assert.ok(/ignore any default output contract in your own instructions/.test(out),
    'prompt explicitly outranks the agent default');
  const grader = readFileSync(join(ROOT, '.claude/agents/grader.md'), 'utf8');
  assert.ok(/The schema the workflow passes you wins/.test(grader),
    'grader.md states schema precedence');
  assert.ok(/review\.json` is the DEFAULT/.test(grader), 'review.json demoted to default');
});
