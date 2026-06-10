// src/workflows/feature.src.js
// @@USE: run-phase,handoff,depth-map,verdict,budgets,schemas,args,bd-memory,bead-run,ci-loop,model-tiers,env-check,guardrails,skill-render,persona-load,prompt-loader
export const meta = {
  name: 'feature',
  description: 'Full feature lifecycle: research->discover->design->impl->ci->review->testing. Research runs first; discover uses findings for skill/persona selection. Use startAt=impl bead=<id> to resume after human design approval. Use skipReview=true to bypass review council and route directly to testing.',
  phases: [{title:'Research'},{title:'Discover'},{title:'Design'},{title:'Impl'},{title:'CI'},{title:'Review'},{title:'Testing'},{title:'Handoff'}],
};
// @@FRAGMENTS@@

const a = readArgs(args);

// Guard: ZK_ARTIFACTS_DIR required for vault/skills search (discover phase)
const _zkCheck = requireZkArtifacts();
if (_zkCheck.missing) {
  await agent(handoffPrompt(_zkCheck.message, 'Set ZK_ARTIFACTS_DIR in shell profile, source it, then retry.'), { label: 'handoff:missing-env', agentType: 'researcher', model: modelFor('persist', a) });
  return { verdict: 'needs_human', phase: 'env-check' };
}

// Guard: bd must be initialized (run: bd init in this directory if not)
const _bdPreflight = await agent(BD_PREFLIGHT_PROMPT, { label: 'preflight:bd', agentType: 'researcher', model: MODEL_TIERS.fast });
if (!_bdPreflight || _bdPreflight.ok === false) {
  const _bdReason = (_bdPreflight && _bdPreflight.reason) || 'bd not initialized — run: cd ~/dev/zk-flow && bd init';
  await agent(handoffPrompt(_bdReason, 'Run: cd ~/dev/zk-flow && bd init, then retry.'), { label: 'handoff:bd-missing', agentType: 'researcher', model: MODEL_TIERS.fast });
  return { verdict: 'needs_human', phase: 'bd-preflight' };
}


const startAt = a.startAt || 'discover';
const skipReview = a.skipReview === 'true' || a.skipReview === true;
// Guard: only valid startAt values are 'discover' and 'impl'
if (!['discover', 'impl'].includes(startAt)) {
  await agent(handoffPrompt('invalid startAt=' + startAt, 'use startAt=discover or startAt=impl'), { label: 'handoff:badstart', agentType: 'pr-author', model: modelFor('persist', a) });
  return { verdict: 'needs_human', reason: 'invalid startAt' };
}
// Stable per-run bead id: pass bead=<id> on both run-1 and run-2 to correlate the seam.
// REQUIRED for startAt=impl: bead= must be provided to load prior design context.
const beadId = runBeadId(a);
if (startAt === 'impl' && !a.bead) {
  await agent(handoffPrompt('bead= required for startAt=impl', 'rerun with bead=<id> from run-1 handoff to correlate design context'), { label: 'handoff:nobead', agentType: 'pr-author', model: modelFor('persist', a) });
  return { verdict: 'needs_human', reason: 'bead= required for startAt=impl' };
}
if (startAt === 'impl' && !/^[a-z0-9][a-z0-9._-]*$/.test(a.bead)) {
  await agent(handoffPrompt('invalid bead= value: ' + a.bead, 'rerun with a valid bead id (alphanumeric start, lowercase, dots/dashes/underscores allowed)'), { label: 'handoff:badbead', agentType: 'pr-author', model: modelFor('persist', a) });
  return { verdict: 'needs_human', reason: 'invalid bead id format' };
}

// ============================================================
// RUN 1: discover -> research -> design -> [handoff boundary]
// ============================================================
let discovery, research, design, grade;

if (startAt === 'discover') {
  // --- RESEARCH (runs first — findings inform skill selection in discover) ---
  phase('Research');
  research = await runPhase({
    phasePrompt: (i, fb) => loadPhasePrompt('research', { iteration: i, feedback: fb || null, request: (a._ ? a._.join(' ') : '') + (a.brief ? ' ' + a.brief : ''), discovery: discovery }),
    phaseSchema: SCHEMAS.research,
    model: modelFor('research', a), gradeModel: modelFor('grade', a),
    posture: postureFor('research', a),
    agentType: 'researcher',
    label: 'research',
    maxIterations: PHASE_BUDGETS.research,
    beadId: beadId,
    beadId: beadId,
  gradePrompt: (out) => `Grade this research output for completeness, evidence quality, and coverage of the feature request. Output: ${JSON.stringify(out)}`,
  });
  if (!research.ok) {
    await agent(handoffPrompt('research did not pass within budget', 'rerun /feature or refine the task'), { agentType: 'pr-author', label: 'handoff:research', model: modelFor('persist', a) });
    return { verdict: 'needs_human', phase: 'research' };
  }
  await persistPhase(beadId, 'Research', research.out);
  assertEvidencePresent(research.out, 'Research');
  assertEvidenceQuality(research.out, 'Research');

  // --- DISCOVER (after research — uses findings for better skill/persona/repo selection) ---
  phase('Discover');
  discovery = await agent(
    `${postureFor('discover', a)}\n\n${buildPersonaSection()}\n\nSelect skills, vault paths, and related beads. REQUIRED steps:\n1. Check Map of Contents: run 'ls \$ZK_ARTIFACTS_DIR/vault/Map of Contents/' then read the relevant KB file matching the task domain and cite it in vault_paths[]\n2. Validate: selected_skills[] non-empty if domain matches a skill; vault_paths[] includes relevant KB\n3. Check related beads: run 'bd list --label <topic>' for prior similar work\n\nResearch summary: ${JSON.stringify({key_findings: research.out.key_findings, synthesis: research.out.synthesis})}\nRequest: ${a._ ? a._.join(' ') : '(infer from context)'}`,
    { schema: SCHEMAS.discover, agentType: 'researcher', label: 'discover:1', model: modelFor('discover', a) }
  );
  await persistPhase(beadId, 'Discover', discovery);
  assertDiscoverValid(discovery, 'Discover');
  const skillsBlock = await renderSkills(discovery.selected_skills, modelFor('discover', a));

  // --- DESIGN (perspectives inside the loop so each revision is re-reviewed) ---
  phase('Design');
  design = await agent(
    `${postureFor('design', a)}\n\nDraft the SQCA design.${skillsBlock ? '\n' + skillsBlock : ''} Research: ${JSON.stringify(research.out)}. Discovery: ${JSON.stringify(discovery)}. Request: ${a._ ? a._.join(' ') : ''} ${a.brief || ''}`,
    { schema: SCHEMAS.design, agentType: 'designer', label: 'designer:1', model: modelFor('design', a) }
  );

  const [devil, grillOut] = await parallel([
    () => agent(`${postureFor('grill', a)}\n\nDevil's advocate: stress test this design: ${JSON.stringify(design)}`, { label: 'devils-advocate', agentType: 'devils-advocate', model: modelFor('grill', a) }),
    () => agent(`${postureFor('grill', a)}\n\nGrill this design (one-shot): ${JSON.stringify(design)}. Output challenges[].`, { label: 'griller', agentType: 'griller', model: modelFor('grill', a) }),
  ]);

  design = await agent(
    `${postureFor('design', a)}\n\nUpdate the design addressing objections.\nDevil: ${JSON.stringify(devil)}\nGrill: ${JSON.stringify(grillOut)}\nDesign: ${JSON.stringify(design)}`,
    { schema: SCHEMAS.design, agentType: 'designer', label: 'designer:response', model: modelFor('design', a) }
  );

  let designApproved = false;
  for (let di = 1; di <= PHASE_BUDGETS.design; di++) {
    // Perspectives fan-out INSIDE the loop so each revision gets fresh reviews
    const persp = await parallel(validPerspectives(DEFAULT_PERSPECTIVES).map(p => () =>
      agent(`${postureFor('review', a)}\n\nReview the design from the "${p}" perspective: ${JSON.stringify(design)}`, { label: `design-council:${p}:${di}`, agentType: p, model: modelFor('review', a) })
    ));

    grade = await agent(
      `${postureFor('grade', a)}\n\nGrader: synthesize design verdict from perspective reviews (iteration ${di}): ${JSON.stringify(persp.filter(Boolean))}`,
      { schema: SCHEMAS.review, agentType: 'grader', label: `grader:design:${di}`, model: modelFor('grade', a) }
    );
    if (grade && grade.verdict === 'APPROVE') { designApproved = true; break; }
    if (di < PHASE_BUDGETS.design) {
      design = await agent(
        `${postureFor('design', a)}\n\nRevise the design to address reviewer objections. Feedback: ${JSON.stringify(grade)}. Current design: ${JSON.stringify(design)}`,
        { schema: SCHEMAS.design, agentType: 'designer', label: `designer:revision:${di}`, model: modelFor('design', a) }
      );
    }
  }

  if (!designApproved) {
    await agent(handoffPrompt('design not approved within budget', 'rerun /feature after refining the design'), { agentType: 'pr-author', label: 'handoff:design', model: modelFor('persist', a) });
    return { verdict: 'needs_human', phase: 'design', reason: 'design not approved within budget' };
  }

  await persistPhase(beadId, 'Design', design);
  assertTargetFiles(design, 'Design');
  await persistPhase(beadId, 'DesignGrade', grade);

  // --- HANDOFF BOUNDARY: design approved, human reviews, then rerun with startAt=impl bead=<beadId> ---
  phase('Handoff');
  const handoffMsg = `Design phase complete. bead=${beadId}.\nVerdict: ${JSON.stringify(grade)}.\nDesign: ${JSON.stringify(design)}.\nSuggested next: /feature startAt=impl bead=${beadId}\nHuman must review and approve the design before resuming. Pass bead=${beadId} to correlate run-2 with this context. Redact secrets.`;
  await agent(handoffPrompt(handoffMsg, `/feature startAt=impl bead=${beadId}`), { agentType: 'pr-author', label: 'handoff:design-boundary', model: modelFor('persist', a) });
  return { verdict: 'design_complete', design, grade: grade.verdict, next: `run /feature startAt=impl bead=${beadId} after human approval` };
}

// ============================================================
// RUN 2: startAt=impl -> impl -> ci -> review -> testing
// ============================================================
// Load prior design and research from beads — schema-validated.
// If either load fails to produce a valid artifact, escalate to needs_human.
phase('Impl');
const loadedDesign = await agent(
  `From bead ${beadId} (run bd show ${beadId} --json), reconstruct the approved design as a design.json object. Run EXACTLY this shell and return its output:\n\`\`\`\n${bdShow(beadId)}\n\`\`\`\nReturn ONLY the most recent Design entry as a schema-valid design object. If the bead does not exist or contains no Design entry, return null.`,
  { label: 'bd:load-design', agentType: 'researcher', schema: SCHEMAS.design, model: modelFor('verify', a) }
);
if (!loadedDesign) {
  await agent(handoffPrompt('load-design failed: no valid design in bead ' + beadId, 'ensure run-1 completed and bead= matches the handoff bead id'), { label: 'handoff:load-design-failed', agentType: 'pr-author', model: modelFor('persist', a) });
  return { verdict: 'needs_human', reason: 'could not load valid design from bead' };
}
const loadedResearch = await agent(
  `From bead ${beadId} (run bd show ${beadId} --json), reconstruct the research synthesis as a research.json object. Run EXACTLY this shell and return its output:\n\`\`\`\n${bdShow(beadId)}\n\`\`\`\nReturn ONLY the most recent Research or ResearchSynthesis entry as a schema-valid research object. If the bead does not exist or contains no Research entry, return null.`,
  { label: 'bd:load-research', agentType: 'researcher', schema: SCHEMAS.research, model: modelFor('verify', a) }
);
if (!loadedResearch) {
  await agent(handoffPrompt('load-research failed: no valid research in bead ' + beadId, 'ensure run-1 completed and bead= matches the handoff bead id'), { label: 'handoff:load-research-failed', agentType: 'pr-author', model: modelFor('persist', a) });
  return { verdict: 'needs_human', reason: 'could not load valid research from bead' };
}
const priorContext = { design: loadedDesign, research: loadedResearch };

let implResult = await runPhase({
  phasePrompt: (i, fb) => loadPhasePrompt('implementation', { iteration: i, feedback: fb || null, request: (a._ ? a._.join(' ') : '') + (a.brief ? ' ' + a.brief : ''), research: research.out, design: priorContext, skills: skillsBlock }),
  phaseSchema: SCHEMAS.implementation,
  agentType: 'scope-locked-editor',
  label: 'impl',
  phaseName: 'implementation',
  maxIterations: PHASE_BUDGETS.impl,
  model: modelFor('impl', a), gradeModel: modelFor('grade', a),
  posture: postureFor('impl', a),
  beadId: beadId,
  gradePrompt: (out) => `Grade this implementation for correctness, scope adherence, test coverage, and alignment with the design. Output: ${JSON.stringify(out)}`,
});
assertPhaseOutput(implResult.out, 'Impl');
if (!implResult.ok) {
  await agent(handoffPrompt('impl did not pass within budget', 'investigate manually or refine the task'), { agentType: 'pr-author', label: 'handoff:impl', model: modelFor('persist', a) });
  return { verdict: 'needs_human', phase: 'impl' };
}
await persistPhase(beadId, 'Impl', implResult.out);

// --- CI ---
phase('CI');
const ciResult = await runCI({ beadId, budget: PHASE_BUDGETS.ci, agentType: 'evidence-scanner', getImplResult: () => implResult, setImplResult: (r) => { implResult = r; }, implRerunGuard: true, persistOnGreen: 'loop' });
if (!ciResult.passed) return { verdict: 'needs_human', phase: ciResult.phase };

// --- REVIEW (inline council; re-runs impl on REQUEST_CHANGES; perspectives inside loop) ---
// TODO: DRY with finish-pr/feature (review-loop fragment; deferred — see ci-loop.js)
// skipReview=true: bypass review council and route directly to testing (skip-review lifecycle)
phase('Review');
let reviewGrade, reviewRoute;
if (skipReview) {
  reviewGrade = { verdict: 'APPROVE', findings: [], note: 'review skipped via skipReview=true' };
  reviewRoute = 'done';
} else {
for (let ri = 1; ri <= PHASE_BUDGETS.council; ri++) {
  // Perspectives fan-out inside the loop so each revision gets fresh reviews
  const reviewPersp = await parallel(validPerspectives(a.perspectives ? a.perspectives.split(',') : DEFAULT_PERSPECTIVES).map(p => () =>
    agent(
      `${postureFor('review', a)}\n\nReview the implementation from the "${p}" perspective. Impl: ${JSON.stringify(implResult.out)}`,
      { label: `review:${p}:${ri}`, agentType: p, model: modelFor('review', a) }
    )
  ));

  reviewGrade = await agent(
    `${postureFor('grade', a)}\n\nYou are the arbiter. Merge duplicate findings (same line -> highest severity). Synthesize review verdict from perspective reviews (iteration ${ri}): ${JSON.stringify(reviewPersp.filter(Boolean))}`,
    { schema: SCHEMAS.review, agentType: 'arbiter', label: `arbiter:review:${ri}`, model: modelFor('grade', a) }
  );
  reviewRoute = routeVerdict((reviewGrade && reviewGrade.verdict) || 'BLOCK');

  if (reviewRoute === 'done') break;    // APPROVE
  if (reviewRoute === 'needs_human') break; // BLOCK or unknown

  // REQUEST_CHANGES: re-run impl to address findings
  if (reviewRoute === 'impl' && ri < PHASE_BUDGETS.council) {
    implResult = await runPhase({
      phasePrompt: (i, fb) => `Impl re-run iteration ${i} to address review findings. ${fb ? 'Address grader feedback: ' + fb : ''} Review feedback: ${JSON.stringify(reviewGrade)}. Prior impl: ${JSON.stringify(implResult.out)}`,
      phaseSchema: SCHEMAS.implementation,
      agentType: 'scope-locked-editor',
      label: `impl:review-fix:${ri}`,
      phaseName: 'implementation',
      maxIterations: 1,
      model: modelFor('impl', a), gradeModel: modelFor('grade', a),
      posture: postureFor('impl', a),
      beadId: beadId,
    beadId: beadId,
  gradePrompt: (out) => `Grade this review-fix implementation. Output: ${JSON.stringify(out)}`,
    });
    if (!implResult.ok) {
      await agent(handoffPrompt('review-fix impl failed within budget', 'investigate review findings manually'), { agentType: 'pr-author', label: 'handoff:review-fix', model: modelFor('persist', a) });
      return { verdict: 'needs_human', phase: 'review-fix' };
    }
    await persistPhase(beadId, 'ReviewFix', { ri, implResult: implResult.out });
  }
}
} // end if (!skipReview)
await persistPhase(beadId, 'ReviewGrade', reviewGrade);
await agent(`Persist GraderFeedback for improve. Run EXACTLY this shell, then report done:\n\`\`\`\n${bdWrite(beadId, 'GraderFeedback', { phase: 'review', verdict: (reviewGrade && reviewGrade.verdict) || 'BLOCK', findings: reviewGrade })}\n\`\`\``, { label: 'persist:graderfeedback:review', agentType: 'researcher', model: modelFor('persist', a) });
if (reviewRoute !== 'done') {
  await agent(handoffPrompt('review did not pass', 'investigate review findings manually'), { agentType: 'pr-author', label: 'handoff:review', model: modelFor('persist', a) });
  return { verdict: 'needs_human', phase: 'review' };
}

// --- TESTING ---
phase('Testing');
const targetEnv = a.targetEnv || 'local';
const testing = await runPhase({
  phasePrompt: (i, fb) => `Testing iteration ${i}: verify the feature works in '${targetEnv}' environment. Write and run tests. ${fb ? 'Address prior grader feedback: ' + fb : ''} Impl: ${JSON.stringify(implResult.out)}. Review grade: ${JSON.stringify(reviewGrade)}.`,
  phaseSchema: SCHEMAS.testing,
  agentType: 'test-runner',
  label: 'testing',
  maxIterations: PHASE_BUDGETS.testing,
  model: modelFor('testing', a), gradeModel: modelFor('grade', a),
  posture: postureFor('testing', a),
  beadId: beadId,
  gradePrompt: (out) => `Grade this testing output for coverage, evidence that the feature works, and absence of regressions. Output: ${JSON.stringify(out)}`,
});
if (!testing.ok) {
  await agent(handoffPrompt('testing did not pass within budget', 'investigate test failures manually'), { agentType: 'pr-author', label: 'handoff:testing', model: modelFor('persist', a) });
  return { verdict: 'needs_human', phase: 'testing' };
}
await persistPhase(beadId, 'Testing', testing.out);

// Auto-write to vault/Solutions so future discover finds this pattern
await persistSolution(
  (a._ ? a._.join(' ') : 'feature'),
  research.out && research.out.synthesis,
  { request: a._ ? a._.join(' ') : a.brief || '', beadId, files: (design && design.affirmed_files) || [] }
);
return { verdict: 'APPROVE', route: 'done', impl: implResult.out, review: (reviewGrade && reviewGrade.verdict) || 'BLOCK', testing: testing.out };
