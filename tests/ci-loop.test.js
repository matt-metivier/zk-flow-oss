// tests/ci-loop.test.js
// Guards the local-vs-remote CI signal in runCI (src/fragments/ci-loop.js).
// feature/small-feature call runCI with no `pr`, so the CI check must verify against a
// LOCAL test gate; otherwise the run stalls at needs_human (no remote CI to
// watch). finish-pr passes `pr` and must keep watching remote PR/MR checks.
// No agent() mock exists in this harness, so these are structural presence
// assertions on the source (same style as feature-resume.test.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(ROOT, '..', 'src/fragments/ci-loop.js'), 'utf8');

test('CI prompt branches on pr presence (ternary)', () => {
  assert.match(SRC, /const ciPrompt = pr\s*\n?\s*\?/, 'ciPrompt must select prompt based on pr presence');
});

test('no-pr branch verifies against a local test gate (npm test)', () => {
  // the local-fallback arm must reference the local test command
  assert.match(SRC, /no PR\/remote CI/i, 'local arm must call out the no-PR case');
  assert.match(SRC, /npm test/, 'local arm must run the project local test command');
});

test('pr branch supports BOTH GitHub and GitLab remote CI', () => {
  assert.match(SRC, /github\.com/, 'remote arm must detect GitHub host');
  assert.match(SRC, /gh pr checks/, 'remote arm must use gh pr checks for GitHub');
  assert.match(SRC, /gitlab/i, 'remote arm must detect GitLab host');
  assert.match(SRC, /glab (ci status|pipeline status)/, 'remote arm must use glab for GitLab');
  assert.match(SRC, /GITLAB_TOKEN/, 'remote arm must offer a GitLab API fallback when glab is absent');
});

test('ci-fix re-run instruction is push-only when a PR exists, local otherwise', () => {
  assert.match(SRC, /pr \? 'Fix failing checks, then commit AND git push/, 'pr arm pushes for remote CI');
  assert.match(SRC, /no push needed/, 'local arm must not require a push');
});

test('CI-fix re-run enters the run worktree (zk-flow-ts2: commits lost otherwise)', () => {
  // The scope-locked-editor CI-fix re-run MUST be prefixed with a worktree
  // bootstrap, or its commits land in an uncontrolled CWD and are lost.
  assert.match(SRC, /const ciFixBootstrap = pr/, 'ciFixBootstrap must branch on pr presence');
  assert.match(SRC, /workspaceBootstrap\(beadId, \{ branch, fetch: true \}\)/, 'pr arm must enter the PR source branch worktree');
  assert.match(SRC, /workspaceBootstrap\(beadId\) \+ '\\n\\n'/, 'local arm must enter the per-bead worktree');
  assert.match(SRC, /phasePrompt: \(i, fb\) => ciFixBootstrap \+ `Impl re-run/, 'CI-fix phasePrompt must prepend ciFixBootstrap');
});

test('runCI accepts an optional branch param for PR-branch worktree entry', () => {
  assert.match(SRC, /branch = null/, 'runCI must destructure an optional branch param');
});
