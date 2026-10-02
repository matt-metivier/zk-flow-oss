// tests/implementation-rubric.test.js
// Guards the tiered verdict mapping in implementation-rubric.md so a sound,
// in-scope implementation isn't blocked on advisory nits (the impl-gate
// over-escalation that stalled the operating-posture run). Mirrors the
// design-rubric and testing-rubric tiering fixes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const SRC = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'prompts/rubrics/implementation-rubric.md'), 'utf8');

test('impl rubric has a tiered verdict mapping (not all-10-must-pass)', () => {
  assert.match(SRC, /## Verdict mapping/);
  assert.doesNotMatch(SRC, /`result` is `satisfied` when ALL 10 criteria pass\./);
  assert.match(SRC, /satisfied` when the verdict is APPROVE/);
});

test('real gates stay blocking: tests, scope, acceptance, blast-radius, schema', () => {
  assert.match(SRC, /BLOCK.*criterion 1.*9/s);          // tests + schema non-negotiable
  assert.match(SRC, /REQUEST_CHANGES.*3.*4.*7/s);       // scope / acceptance / blast-radius
});

test('advisory criteria do not block (large in-scope change is fine)', () => {
  assert.match(SRC, /ADVISORY/);
  assert.match(SRC, /touching many files is fine when every file is within/);
  assert.match(SRC, /record them in `gaps_for_agent`[\s\S]*?and APPROVE/);
});

test('the four hygiene gates dropped in the zk-hub port are present', () => {
  // zk-flow's rubrics were ported from zk-hub (they still cite
  // --injected-by: src/cli/spawner/grader.rs). Diffing the upstream originals —
  // recoverable from zk-artifacts history at vault/Prompts/prompts/rubrics/ — showed
  // four gates solved upstream and lost in the port, covered nowhere else in this repo.
  assert.match(SRC, /No hardcoded secrets/, 'secrets gate');
  assert.match(SRC, /Lint \/ typecheck gate is clean/, 'static-analysis gate');
  assert.match(SRC, /No stubs left in shipped code/, 'stub gate');
  assert.match(SRC, /Commit messages follow the convention/, 'commit-message gate');
  // The secrets gate must be a BLOCK, not advisory: a pushed secret can only be rotated.
  assert.match(SRC, /or 12 \(a hardcoded secret in the diff\)\. Non-negotiable/,
    'secrets is a hard BLOCK in the verdict mapping');
  assert.match(SRC, /13 \(the repo HAS a static gate and it was skipped/,
    'lint gate is REQUEST_CHANGES when the repo has one');
});
