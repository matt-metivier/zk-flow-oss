// tests/design-graderfeedback-persist.test.js
// Guards that the hand-rolled design council loops (feature + design workflows)
// persist GraderFeedback after every grader call, the same contract runPhase
// honors. Regression: the design loop graded but never persisted, so /improve
// was blind to design-phase failures and a needs_human exit left no bead record
// of why design blocked.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(ROOT, '..', p), 'utf8');

for (const wf of ['src/workflows/feature.src.js', 'src/workflows/design.src.js']) {
  test(`${wf} design loop persists GraderFeedback every iteration`, () => {
    const SRC = read(wf);
    // the grader call must be followed by a GraderFeedback persist for phase 'design'
    assert.match(SRC, /label: `grader:design:\$\{di\}`/, 'design grader call present');
    assert.match(SRC, /persist:graderfeedback:design:\$\{di\}/, 'must persist GraderFeedback per design iteration');
    assert.match(SRC, /bdWrite\(beadId, 'GraderFeedback', \{ phase: 'design'/, 'persist must use the GraderFeedback bdWrite for phase design');
    // and it must sit before the APPROVE break so the approving + blocking grades both persist
    const persistIdx = SRC.indexOf('persist:graderfeedback:design');
    const breakIdx = SRC.indexOf("verdict === 'APPROVE') { designApproved = true; break;");
    assert.ok(persistIdx !== -1 && breakIdx !== -1 && persistIdx < breakIdx,
      'GraderFeedback persist must precede the APPROVE break');
  });
}
