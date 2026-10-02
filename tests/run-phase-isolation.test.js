// tests/run-phase-isolation.test.js
// Guards bax: runPhase must forward isolation:'worktree' to the PHASE agent()
// (the Workflow runtime ignores the agent-frontmatter `isolation`; only the
// agent() opt spawns a real per-writer worktree). Grader/persist agents are
// read-only and must NOT get it. Writer phases in the workflows must pass it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(ROOT, '..', p), 'utf8');

test('runPhase accepts an isolation param and forwards it to the phase agent only', () => {
  const src = read('src/fragments/run-phase.js');
  assert.match(src, /isolation = null/, 'runPhase signature takes isolation');
  assert.match(src, /const iso = enforcedIsolation \? \{ isolation: enforcedIsolation \} : \{\}/, 'builds the iso opt');
  // both phase agent() calls (main loop + escalation) spread iso
  const phaseSpreads = (src.match(/\.\.\.iso\b/g) || []).length;
  assert.ok(phaseSpreads >= 2, `phase agent() calls must spread iso (found ${phaseSpreads})`);
  // grader/persist calls must NOT get iso — they're read-only. Check the grader line.
  const graderLine = src.split('\n').find(l => l.includes("agentType: 'grader'"));
  assert.ok(graderLine && !graderLine.includes('...iso'), 'grader agent() must not get isolation');
});

test('runPhase ENFORCES worktree isolation for writer agent types', () => {
  const src = read('src/fragments/run-phase.js');
  // writer set must include the code editor; enforcement forces 'worktree' when a
  // caller omits isolation so a writer phase can never silently run un-sandboxed.
  assert.match(src, /WRITER_AGENT_TYPES\s*=\s*\[[^\]]*'scope-locked-editor'/, 'scope-locked-editor is a writer');
  assert.match(src, /!isolation && WRITER_AGENT_TYPES\.includes\(agentType\)\) \? 'worktree' : isolation/, 'forces worktree for writers when isolation omitted');
});

test('writer runPhase calls in the workflows pass isolation:worktree', () => {
  // every scope-locked-editor phase is a writer and must be sandboxed
  for (const f of ['src/workflows/feature.src.js',
                   'src/workflows/finish-pr.src.js', 'src/workflows/refactor.src.js',
                   'src/workflows/debug.src.js']) {
    const src = read(f);
    const writers = (src.match(/agentType: 'scope-locked-editor'/g) || []).length;
    const isos = (src.match(/isolation: 'worktree'/g) || []).length;
    assert.ok(isos >= writers, `${f}: ${writers} writer phase(s) but ${isos} isolation flag(s)`);
  }
  // ci-loop's ci-fix re-run is also a writer
  const ci = read('src/fragments/ci-loop.js');
  assert.match(ci, /isolation: 'worktree'/, 'ci-loop ci-fix re-run must be isolated too');
});
