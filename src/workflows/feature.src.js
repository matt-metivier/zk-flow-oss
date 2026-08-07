// src/workflows/feature.src.js
// @@USE: run-phase,backtrack,handoff,depth-map,verdict,budgets,schemas,args,bd-memory,bead-run,ci-loop,model-tiers,env-check,guardrails,skill-render,persona-load,prompt-loader,operating-posture,claim-verify,findings-route,phase-router,pause-operator
export const meta = {
  name: 'feature',
  description: 'Full feature lifecycle: research->discover->design->impl->ci->simplify->review->testing. Research runs first; discover uses findings for skill/persona selection. Use startAt=<phase> bead=<id> to resume from a completed checkpoint. Use skipReview=true to bypass review council and route directly to testing. Use skipSimplify=true to bypass the post-impl simplify pass. Use profile=small for a lean lifecycle (no design panel, no review council) -- replaces the former /small-feature.',
  phases: [{title:'Research'},{title:'Discover'},{title:'Design'},{title:'Impl'},{title:'CI'},{title:'Simplify'},{title:'Review'},{title:'Testing'},{title:'Handoff'}],
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


const startAt = a.startAt || 'research';
const profile = (a.profile === 'small') ? 'small' : 'full';
if (a.profile !== undefined && a.profile !== 'full' && a.profile !== 'small') {
  await agent(handoffPrompt('invalid profile=' + a.profile, 'use profile=full (default) or profile=small'), { label: 'handoff:badprofile', agentType: 'pr-author', model: modelFor('persist', a) });
  return { verdict: 'needs_human', reason: 'invalid profile' };
}
const skipReview = profile === 'small' || a.skipReview === 'true' || a.skipReview === true;
const skipSimplify = a.skipSimplify === 'true' || a.skipSimplify === true;
// Guard: only valid startAt values are checkpoint boundaries.
if (!['research', 'discover', 'design', 'impl', 'ci', 'review', 'testing'].includes(startAt)) {
  await agent(handoffPrompt('invalid startAt=' + startAt, 'use startAt=research, discover, design, impl, ci, review, or testing'), { label: 'handoff:badstart', agentType: 'pr-author', model: modelFor('persist', a) });
  return { verdict: 'needs_human', reason: 'invalid startAt' };
}
if (profile === 'small' && startAt === 'design') {
  await agent(handoffPrompt('startAt=design invalid with profile=small (no design phase)', 'use profile=full, or resume small at startAt=impl/ci/testing'), { label: 'handoff:smalldesign', agentType: 'pr-author', model: modelFor('persist', a) });
  return { verdict: 'needs_human', reason: 'startAt=design incompatible with profile=small' };
}
// Stable per-run bead id: pass bead=<id> on resumes to correlate the seam.
const beadId = runBeadId(a);
if (startAt !== 'research' && !a.bead) {
  await agent(handoffPrompt('bead= required for startAt=' + startAt, 'rerun with bead=<id> from the prior checkpoint handoff'), { label: 'handoff:nobead', agentType: 'pr-author', model: modelFor('persist', a) });
  return { verdict: 'needs_human', reason: 'bead= required for resume' };
}
if (startAt !== 'research' && !/^[a-z0-9][a-z0-9._-]*$/.test(a.bead)) {
  await agent(handoffPrompt('invalid bead= value: ' + a.bead, 'rerun with a valid bead id (alphanumeric start, lowercase, dots/dashes/underscores allowed)'), { label: 'handoff:badbead', agentType: 'pr-author', model: modelFor('persist', a) });
  return { verdict: 'needs_human', reason: 'invalid bead id format' };
}

// Lifecycle: open -> in_progress. Idempotent across run-1/run-2 (same beadId).
await claimRun(beadId);

async function loadPhaseResumeContext(beadId, phase) {
  if (!beadId || phase === 'research') return null;
  return agent(
    `Load bounded checkpoint context for resuming phase ${phase}. Run EXACTLY this shell and summarize the latest matching checkpoint plus nearby bead context:
\`\`\`
${bdPhaseResumeContext(beadId, phase, { nSame: 5, nCross: 3 })}
\`\`\``,
    { label: `bd:resume-context:${phase}`, agentType: 'researcher', model: modelFor('verify', a) }
  );
}

// ============================================================
// RUN 1: discover -> research -> design -> [handoff boundary]
// ============================================================
let discovery, research, design, grade;
let skillsBlock;

const runPhaseBoundaryLabels = ['research', 'impl', 'testing'];
const assertKnownRunPhaseBoundary = (ret) => {
  if (!ret || !runPhaseBoundaryLabels.includes(ret.label)) {
    throw new Error('unknown runPhase boundary label: ' + (ret && ret.label));
  }
  return true;
};
const isResearchBoundary = (ret) => ret.label === 'research';
const isImplBoundary = (ret) => ret.label === 'impl';
const isTestingBoundary = (ret) => ret.label === 'testing';
const phaseOk = (ret) => ret.ok === true;
const phaseFailed = (ret) => ret.ok !== true;
const runPhaseBoundaryGates = [
  { when: and_(assertKnownRunPhaseBoundary, isResearchBoundary, phaseOk), route: { verdict: 'continue', phase: 'research' } },
  { when: and_(assertKnownRunPhaseBoundary, isResearchBoundary, phaseFailed), route: { verdict: 'needs_human', phase: 'research', handoff: 'research did not pass within budget', next: 'rerun /feature or refine the task' } },
  { when: and_(assertKnownRunPhaseBoundary, isImplBoundary, phaseOk), route: { verdict: 'continue', phase: 'impl' } },
  { when: and_(assertKnownRunPhaseBoundary, isImplBoundary, phaseFailed), route: { verdict: 'needs_human', phase: 'impl', handoff: 'impl did not pass within budget', next: 'investigate manually or refine the task' } },
  { when: and_(assertKnownRunPhaseBoundary, isTestingBoundary, phaseOk), route: { verdict: 'continue', phase: 'testing' } },
  { when: and_(assertKnownRunPhaseBoundary, isTestingBoundary, phaseFailed), route: { verdict: 'needs_human', phase: 'testing', handoff: 'testing did not pass within budget', next: 'investigate test failures manually' } },
];

async function handleRunPhaseBoundary(label, ret) {
  const route = routePhase(runPhaseBoundaryGates, { ...(ret || {}), label });
  if (route.verdict === 'continue') return null;

  const phaseName = route.phase && route.phase !== 'unknown' ? route.phase : label;
  await agent(handoffPrompt(route.handoff || (phaseName + ' did not pass within budget'), route.next || 'investigate manually'), { agentType: 'pr-author', label: 'handoff:' + phaseName, model: modelFor('persist', a) });
  return { verdict: 'needs_human', phase: phaseName };
}

if (startAt === 'research' || startAt === 'discover' || startAt === 'design') {
  if (startAt === 'research') {
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
    canEscalate: !(a.model || a.models),
    startTier: PHASE_TIER['research'],
  gradePrompt: (out) => `Grade this research output for completeness, evidence quality, and coverage of the feature request. Output: ${JSON.stringify(out)}`,
  });
  const researchRoute = await handleRunPhaseBoundary('research', research);
  if (researchRoute) return researchRoute;
  // --- VERIFY (abstention-aware adversarial claim quorum before research feeds discover/design) ---
  const _verify = salvagePhase(await verifyClaims(research.out, {
    verifyVotes: a.verifyVotes, maxClaims: a.maxClaims, refuteThreshold: a.refuteThreshold,
    model: modelFor('review', a),
  }), 'ClaimVerify');
  if (_verify && !_verify.skipped && Array.isArray(_verify.kept)) {
    research.out.key_findings = _verify.kept;
  }
  await persistPhaseSoft(beadId, 'ClaimVerify', {
    kept: (_verify && _verify.kept ? _verify.kept.length : null),
    killed: (_verify && _verify.killed ? _verify.killed.length : 0),
    skipped: !!(_verify && _verify.skipped),
  });

  await persistPhase(beadId, 'Research', research.out);
  await persistPhaseCheckpoint(beadId, 'Research', research.out);
  await persistArtifact(beadId, 'ResearchDoc', '$TMPDIR/research.md');
  assertEvidencePresent(research.out, 'Research');
  assertEvidenceQuality(research.out, 'Research');
  } else {
    const phaseResumeContext = await loadPhaseResumeContext(beadId, startAt);
    const loadedResearch = await agent(
      `From bead ${beadId} (run bd show ${beadId} --json), reconstruct the research synthesis as a research.json object. Checkpoint context: ${JSON.stringify(phaseResumeContext)}. Run EXACTLY this shell and return its output:\n\`\`\`\n${bdShow(beadId)}\n\`\`\`\nReturn ONLY the most recent Research entry as a schema-valid research object. If the bead does not exist or contains no Research entry, return null.`,
      { label: 'bd:load-research', agentType: 'researcher', schema: SCHEMAS.research, model: modelFor('verify', a) }
    );
    if (!loadedResearch) {
      await agent(handoffPrompt('load-research failed: no valid research in bead ' + beadId, 'ensure the bead has a completed Research checkpoint'), { label: 'handoff:load-research-failed', agentType: 'pr-author', model: modelFor('persist', a) });
      return { verdict: 'needs_human', reason: 'could not load valid research from bead' };
    }
    research = { out: loadedResearch };
  }

  if (startAt !== 'design') {
  // --- DISCOVER (after research — uses findings for better skill/persona/repo selection) ---
  phase('Discover');
  const catalogLimits = discoverCatalogLimits(a);
  const catalogCommand = buildDiscoverCatalogCommand({
    request: (a._ ? a._.join(' ') : '') + (a.brief ? ' ' + a.brief : ''),
    research: research.out,
    topK: a.topK,
  });
  discovery = await agent(
    `${postureFor('discover', a)}

${buildPersonaSection()}

Call StructuredOutput with the schema fields at the TOP LEVEL of the tool input — do NOT wrap them in an output key.
Select skills, vault paths, and related beads. REQUIRED steps (run the shell, do not answer from memory):
1. Skill catalog: run this relevance-gated prefilter command first:
\`\`\`
${catalogCommand}
\`\`\`
You may select skill ids ONLY from the catalog output — COPY each id exactly as written between the backticks (do not adjust category dirs from memory; e.g. observability-stack lives under general/tools/, not general/infrastructure/). If the command prints PREFILTER_FALLBACK_FULL_CATALOG, use that full catalog. If the filtered catalog clearly lacks needed coverage, run 'cat \"$ZK_ARTIFACTS_DIR/skills/CATALOG.md\"' as a correctness fallback before selecting. From filtered output, select at most ${catalogLimits.topK} skills unless full-catalog fallback is needed. Any id not in the catalog output is invalid.
2. Map of Maps: run 'cat \"$ZK_ARTIFACTS_DIR/vault/Map of Contents/Map of Maps.md\"', pick the MOC matching the task domain, cat that MOC file, cite its path in vault_paths[] and its filename in moc_consulted (or set moc_consulted to no_moc_match).
3. Prior solutions: run 'ls \"$ZK_ARTIFACTS_DIR/vault/Solutions/\" 2>/dev/null | grep -i <keyword>' and cite matches in vault_paths[].
4. Related beads: run the bounded retrieval below and cite the ids that actually relate (same-subject first, then cross-subject recency):\n\`\`\`\n${bdBoundedContext((a.brief || (a._ ? a._.join(' ') : '')).slice(0, 120), { nSame: 5, nCross: 3 })}\n\`\`\` and cite matching ids in related_beads[].
5. Validate: every skills[] entry appears verbatim in the catalog output; vault_paths[] includes the consulted MOC.

Research summary: ${JSON.stringify({key_findings: research.out.key_findings, synthesis: research.out.synthesis})}
Request: ${a._ ? a._.join(' ') : '(infer from context)'}`,
    { schema: SCHEMAS.discover, agentType: 'researcher', label: 'discover:1', model: modelFor('discover', a) }
  );
  await persistPhase(beadId, 'Discover', discovery);
  await persistPhaseCheckpoint(beadId, 'Discover', discovery);
  assertDiscoverValid(discovery, 'Discover');
  assertSelectedSkillsValid(discovery.skills, 'feature');
  skillsBlock = await renderSkills(discovery.skills, modelFor('discover', a));
  } else {
    const phaseResumeContext = await loadPhaseResumeContext(beadId, startAt);
    const loadedDiscover = await agent(
      `From bead ${beadId} (run bd show ${beadId} --json), reconstruct discover output as a discover.json object. Checkpoint context: ${JSON.stringify(phaseResumeContext)}. Run EXACTLY this shell and return its output:\n\`\`\`\n${bdShow(beadId)}\n\`\`\`\nReturn ONLY the most recent Discover entry as a schema-valid discover object. If the bead does not exist or contains no Discover entry, return null.`,
      { label: 'bd:load-discover', agentType: 'researcher', schema: SCHEMAS.discover, model: modelFor('verify', a) }
    );
    if (!loadedDiscover) {
      await agent(handoffPrompt('load-discover failed: no valid Discover in bead ' + beadId, 'ensure the bead has a completed Discover checkpoint'), { label: 'handoff:load-discover-failed', agentType: 'pr-author', model: modelFor('persist', a) });
      return { verdict: 'needs_human', reason: 'could not load valid discover from bead' };
    }
    discovery = loadedDiscover;
    assertDiscoverValid(discovery, 'Discover');
    assertSelectedSkillsValid(discovery.skills, 'feature');
    skillsBlock = await renderSkills(discovery.skills, modelFor('discover', a));
  }

  if (profile !== 'small') {
  // --- VALIDATION CONTRACT (before design defines its approach — two-level TDD) ---
  phase('Design');
  const contract = salvagePhase(await agent(
    loadPhasePrompt('validation-contract', { request: (a._ ? a._.join(' ') : '') + (a.brief ? ' ' + a.brief : ''), research: research.out }),
    { schema: SCHEMAS['validation-contract'], agentType: 'designer', label: 'validation-contract', model: modelFor('design', a) }
  ), 'ValidationContract');
  const _contract = (contract && !contract.skipped) ? contract : null;
  if (_contract) await persistPhaseSoft(beadId, 'ValidationContract', _contract);

  // --- DESIGN (perspectives inside the loop so each revision is re-reviewed) ---
  design = await agent(
    `${postureFor('design', a)}\n\nDraft the SQCA design.${skillsBlock ? '\n' + skillsBlock : ''}${_contract ? '\n\n## Validation contract (your approach MUST satisfy every assertion)\n' + JSON.stringify(_contract) : ''} Research: ${JSON.stringify(research.out)}. Discovery: ${JSON.stringify(discovery)}. Request: ${a._ ? a._.join(' ') : ''} ${a.brief || ''}`,
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
    // Persist GraderFeedback every iteration (mirrors run-phase.js) so /improve
    // can cluster design failures and a needs_human exit leaves a bead record of
    // WHY design blocked. The hand-rolled design loop doesn't use runPhase, so
    // without this the design phase -- the most expensive, most-failing phase --
    // is invisible to the self-improve loop and to resume.
    if (grade) {
      await agent(
        `Persist GraderFeedback. Run EXACTLY this shell, then report done:\n\`\`\`\n${bdWrite(beadId, 'GraderFeedback', { phase: 'design', iteration: di, verdict: grade.verdict, weighted_score: grade.weighted_score, findings: (grade.findings || []).slice(0, 5) })}\n\`\`\``,
        { label: `persist:graderfeedback:design:${di}`, agentType: 'persist', model: MODEL_TIERS.fast }
      );
    }
    // Validators-never-fix: non-APPROVE findings become a FixTask comment for scope-locked-editor.
    if (grade && grade.verdict !== 'APPROVE') {
      await routeFindingsToBead(beadId, grade, { phase: 'design', iteration: di });
    }
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
  await persistPhaseCheckpoint(beadId, 'Design', design);
  await persistArtifact(beadId, 'DesignDoc', '$TMPDIR/design.md');
  assertTargetFiles(design, 'Design');
  await persistPhase(beadId, 'DesignGrade', grade);

  // --- HANDOFF BOUNDARY: design approved. Stop for human approval UNLESS
  // autoApprove=true, in which case fall through into RUN 2 (which reloads the
  // just-persisted design from the bead) and run impl->ci->review->testing in
  // the same invocation — no manual `startAt=impl` rerun needed.
  if (shouldPauseBefore('impl', a.pauseBefore)) {
    phase('Handoff');
    return await pauseForOperator({
      agent,
      handoffPrompt,
      phaseName: 'implementation',   // rubric file is implementation-rubric.md; 'impl' pointed the grader at a path that does not exist
      beadId,
      resumeCommand: `/feature startAt=impl bead=${beadId}`,
      reason: 'pauseBefore=impl',
      payload: { design, grade: grade.verdict },
      model: modelFor('persist', a),
    });
  }
  if (!(a.autoApprove === true || a.autoApprove === 'true')) {
    phase('Handoff');
    const handoffMsg = `Design phase complete. bead=${beadId}.\nVerdict: ${JSON.stringify(grade)}.\nDesign: ${JSON.stringify(design)}.\nSuggested next: /feature startAt=impl bead=${beadId}\nHuman must review and approve the design before resuming. Pass bead=${beadId} to correlate run-2 with this context. Redact secrets.`;
    await agent(handoffPrompt(handoffMsg, `/feature startAt=impl bead=${beadId}`), { agentType: 'pr-author', label: 'handoff:design-boundary', model: modelFor('persist', a) });
    return { verdict: 'design_complete', design, grade: grade.verdict, next: `run /feature startAt=impl bead=${beadId} after human approval` };
  }
  log(`autoApprove=true — chaining approved design directly into impl (no human seam); RUN 2 reloads design from bead ${beadId}`);
  }
}

// ============================================================
// RUN 2: startAt=impl -> impl -> ci -> review -> testing
// ============================================================
// Load prior design and research from beads — schema-validated.
// If either load fails to produce a valid artifact, escalate to needs_human.
const phaseResumeContext = await loadPhaseResumeContext(beadId, startAt);
phase(startAt === 'ci' ? 'CI' : startAt === 'review' ? 'Review' : startAt === 'testing' ? 'Testing' : 'Impl');
let loadedDesign = null;
if (profile !== 'small') {
loadedDesign = await agent(
  `From bead ${beadId} (run bd show ${beadId} --json), reconstruct the approved design as a design.json object. Run EXACTLY this shell and return its output:\n\`\`\`\n${bdShow(beadId)}\n\`\`\`\nUse this checkpoint context as a hint, but trust the bead JSON: ${JSON.stringify(phaseResumeContext)}. Return ONLY the most recent Design entry as a schema-valid design object. If the bead does not exist or contains no Design entry, return null.`,
  { label: 'bd:load-design', agentType: 'researcher', schema: SCHEMAS.design, model: modelFor('verify', a) }
);
if (!loadedDesign) {
  await agent(handoffPrompt('load-design failed: no valid design in bead ' + beadId, 'ensure run-1 completed and bead= matches the handoff bead id'), { label: 'handoff:load-design-failed', agentType: 'pr-author', model: modelFor('persist', a) });
  return { verdict: 'needs_human', reason: 'could not load valid design from bead' };
}
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
// Wire loaded context into outer bindings so impl prompt and persistSolution have access
research = { out: loadedResearch };
design = loadedDesign;
assertSelectedSkillsValid((loadedResearch && loadedResearch.selected_skills) || [], 'feature');
skillsBlock = await renderSkills((loadedResearch && loadedResearch.selected_skills) || [], modelFor('discover', a));

phase('Impl');
let implResult;
if (['ci', 'review', 'testing'].includes(startAt)) {
  const loadedImpl = await agent(
    `From bead ${beadId} (run bd show ${beadId} --json), reconstruct the approved implementation as an implementation.json object. Checkpoint context: ${JSON.stringify(phaseResumeContext)}. Run EXACTLY this shell and return its output:\n\`\`\`\n${bdShow(beadId)}\n\`\`\`\nReturn ONLY the most recent Impl entry as a schema-valid implementation object. If the bead does not exist or contains no Impl entry, return null.`,
    { label: 'bd:load-impl', agentType: 'researcher', schema: SCHEMAS.implementation, model: modelFor('verify', a) }
  );
  if (!loadedImpl) {
    await agent(handoffPrompt('load-impl failed: no valid implementation in bead ' + beadId, 'ensure the bead has a completed Impl checkpoint'), { label: 'handoff:load-impl-failed', agentType: 'pr-author', model: modelFor('persist', a) });
    return { verdict: 'needs_human', reason: 'could not load valid implementation from bead' };
  }
  implResult = { ok: true, out: loadedImpl, resumed: true };
} else {
const runImpl = () => runPhase({
  phasePrompt: (i, fb) => workspaceBootstrap(beadId) + '\n\n' + workspaceBootstrapRepos(beadId, (priorContext.design && priorContext.design.affirmed_files) || []) + '\n\n' + loadPhasePrompt('implementation', { iteration: i, feedback: fb || null, request: (a._ ? a._.join(' ') : '') + (a.brief ? ' ' + a.brief : ''), research: research.out, design: priorContext, skills: skillsBlock }),
  phaseSchema: SCHEMAS.implementation,
  agentType: 'scope-locked-editor',
  isolation: 'worktree',
  label: 'impl',
  phaseName: 'implementation',
  maxIterations: PHASE_BUDGETS.impl,
  model: modelFor('impl', a), gradeModel: modelFor('grade', a),
  posture: postureFor('impl', a),
  beadId: beadId,
  gradePrompt: (out) => `Grade this implementation for correctness, scope adherence, test coverage, and alignment with the design. Output: ${JSON.stringify(out)}`,
});
if (profile === 'small') {
  // Backtrack (ported from the former /bugfix, which this profile replaces): if impl
  // exhausts its budget, re-investigate root cause via research (up to PHASE_BUDGETS.backtrack
  // times, default 0 = off) before needs_human. Only wired for profile=small — full profile's
  // Impl phase sits past the human design-approval seam, where re-running Research would
  // silently invalidate an already-approved design. discover/skills are not refreshed on
  // backtrack — research.out is the lever (YAGNI, mirrors former /bugfix).
  const runResearchBacktrack = (backtrackSeed) => runPhase({
    phasePrompt: (i, fb) => loadPhasePrompt('research', { iteration: i, feedback: fb || null, request: (a._ ? a._.join(' ') : '') + (a.brief ? ' ' + a.brief : '') + (backtrackSeed ? `\n\nPrior impl attempt failed; re-investigate the root cause with this in mind: ${backtrackSeed}` : ''), discovery: discovery }),
    phaseSchema: SCHEMAS.research,
    model: modelFor('research', a), gradeModel: modelFor('grade', a),
    posture: postureFor('research', a),
    agentType: 'researcher',
    label: 'research',
    maxIterations: PHASE_BUDGETS.research,
    beadId: beadId,
    gradePrompt: (out) => `Grade this research output for completeness, evidence quality, and root cause clarity. Output: ${JSON.stringify(out)}`,
  });
  const reResearch = async (fb) => {
    const btResearch = await runResearchBacktrack(fb);
    if (btResearch.ok) {
      research = { out: btResearch.out };
      await persistPhase(beadId, 'Research', btResearch.out);
      await persistPhaseCheckpoint(beadId, 'Research', btResearch.out);
    }
    return btResearch;
  };
  implResult = await runWithBacktrack(reResearch, runImpl, { budget: PHASE_BUDGETS.backtrack, label: 'impl' });
} else {
  implResult = await runImpl();
}
}
assertPhaseOutput(implResult.out, 'Impl');
const implRoute = await handleRunPhaseBoundary('impl', implResult);
if (implRoute) return implRoute;
await persistPhase(beadId, 'Impl', implResult.out);

// Scope gate: impl must stay inside the design's affirmed_files (plus tests/docs).
// Nothing enforced this before — the guardrail existed but its comment deferred to a
// settings.json hook that does not exist. Routed to handoff rather than thrown: the work
// has already happened, so the operator needs the file list, not a stack trace.
const _scopeViol = scopeViolations(
  (implResult.out && implResult.out.files_changed) || [],
  (design && design.affirmed_files) || []
);
if (_scopeViol.length > 0) {
  await agent(handoffPrompt(
    `impl changed ${_scopeViol.length} file(s) outside the design's affirmed_files: ${_scopeViol.join(', ')}`,
    'Review those files: either widen the design (re-run /design or edit affirmed_files on the bead) or revert them, then re-run /feature startAt=impl'
  ), { label: 'handoff:scope-exceeded', agentType: 'pr-author', model: modelFor('persist', a) });
  await persistPhaseSoft(beadId, 'ScopeViolation', { files: _scopeViol, affirmed: (design && design.affirmed_files) || [] });
  return { verdict: 'needs_human', phase: 'impl', reason: 'scope_exceeded', files: _scopeViol, bead: beadId };
}

await persistPhaseCheckpoint(beadId, 'Impl', implResult.out);

// --- CI ---
if (!['review', 'testing'].includes(startAt)) {
phase('CI');
const ciResult = await runCI({ beadId, budget: PHASE_BUDGETS.ci, implModel: modelFor('impl', a), gradeModel: modelFor('grade', a), agentType: 'evidence-scanner', getImplResult: () => implResult, setImplResult: (r) => { implResult = r; }, implRerunGuard: true, persistOnGreen: 'loop' });
if (!ciResult.passed) return { verdict: 'needs_human', phase: ciResult.phase };
}

// --- SIMPLIFY (single bounded pass: reuse/dead-code/altitude cleanups, applied directly, then re-verified via CI) ---
// Polish, not a gate: a failed or skipped pass keeps the pre-simplify implResult and proceeds.
if (!['review', 'testing'].includes(startAt) && !skipSimplify) {
phase('Simplify');
const simplifyResult = await runPhase({
  phasePrompt: (i, fb) => workspaceBootstrap(beadId) + '\n\n' +
    `Simplify pass: review the implementation for reuse misses, unrequested abstraction, dead code, and altitude mismatches (ceremony disproportionate to the change), then apply the fixes directly. Do NOT change behavior, scope, or public contracts. ${fb ? 'Address prior grader feedback: ' + fb : ''} Implementation: ${JSON.stringify(implResult.out)}`,
  phaseSchema: SCHEMAS.implementation,
  agentType: 'scope-locked-editor',
  isolation: 'worktree',
  label: 'simplify',
  phaseName: 'simplify',
  maxIterations: 1,
  model: modelFor('impl', a), gradeModel: modelFor('grade', a),
  posture: postureFor('impl', a),
  beadId: beadId,
  gradePrompt: (out) => `Grade this simplify pass: did it reduce duplication/complexity WITHOUT changing behavior, scope, or public contracts, and does it report tests still passing? Output: ${JSON.stringify(out)}`,
});
if (simplifyResult.ok) {
  implResult = simplifyResult;
  await persistPhase(beadId, 'Simplify', implResult.out);
  await persistPhaseCheckpoint(beadId, 'Impl', implResult.out);
  const simplifyCiResult = await runCI({ beadId, budget: PHASE_BUDGETS.ci, implModel: modelFor('impl', a), gradeModel: modelFor('grade', a), agentType: 'evidence-scanner', getImplResult: () => implResult, setImplResult: (r) => { implResult = r; }, implRerunGuard: true, persistOnGreen: 'loop' });
  if (!simplifyCiResult.passed) return { verdict: 'needs_human', phase: simplifyCiResult.phase };
}
}

// --- REVIEW (inline council; re-runs impl on REQUEST_CHANGES; perspectives inside loop) ---
// TODO: DRY with finish-pr/feature (review-loop fragment; deferred — see ci-loop.js)
// skipReview=true: bypass review council and route directly to testing (skip-review lifecycle)
let reviewGrade, reviewRoute;
if (startAt === 'testing') {
  const loadedReviewGrade = await agent(
    `From bead ${beadId} (run bd show ${beadId} --json), reconstruct the review grade as a review.json object. Checkpoint context: ${JSON.stringify(phaseResumeContext)}. Run EXACTLY this shell and return its output:\n\`\`\`\n${bdShow(beadId)}\n\`\`\`\nReturn ONLY the most recent ReviewGrade entry as a schema-valid review object. If the bead does not exist or contains no ReviewGrade entry, return null.`,
    { label: 'bd:load-reviewgrade', agentType: 'researcher', schema: SCHEMAS.review, model: modelFor('verify', a) }
  );
  if (!loadedReviewGrade) {
    await agent(handoffPrompt('load-review failed: no valid ReviewGrade in bead ' + beadId, 'ensure the bead has a completed review checkpoint'), { label: 'handoff:load-review-failed', agentType: 'pr-author', model: modelFor('persist', a) });
    return { verdict: 'needs_human', reason: 'could not load valid review from bead' };
  }
  reviewGrade = loadedReviewGrade;
  reviewRoute = 'done';
} else {
phase('Review');
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

  // Validators-never-fix: route non-APPROVE review findings as FixTask comments before re-impl.
  if (reviewGrade && reviewGrade.verdict !== 'APPROVE') {
    await routeFindingsToBead(beadId, reviewGrade, { phase: 'review', iteration: ri });
  }

  if (reviewRoute === 'done') break;    // APPROVE
  if (reviewRoute === 'needs_human') break; // BLOCK or unknown

  // REQUEST_CHANGES: re-run impl to address findings
  if (reviewRoute === 'impl' && ri < PHASE_BUDGETS.council) {
    implResult = await runPhase({
      phasePrompt: (i, fb) => workspaceBootstrap(beadId) + '\n\n' + workspaceBootstrapRepos(beadId, (priorContext.design && priorContext.design.affirmed_files) || []) + '\n\n' + `Impl re-run iteration ${i} to address review findings. ${fb ? 'Address grader feedback: ' + fb : ''} Review feedback: ${JSON.stringify(reviewGrade)}. Prior impl: ${JSON.stringify(implResult.out)}`,
      phaseSchema: SCHEMAS.implementation,
      agentType: 'scope-locked-editor',
      isolation: 'worktree',
      label: `impl:review-fix:${ri}`,
      phaseName: 'implementation',
      maxIterations: 1,
      model: modelFor('impl', a), gradeModel: modelFor('grade', a),
      posture: postureFor('impl', a),
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
} // end review resume branch
await persistPhase(beadId, 'ReviewGrade', reviewGrade);
await persistPhaseCheckpoint(beadId, 'ReviewGrade', reviewGrade);
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
const testingRoute = await handleRunPhaseBoundary('testing', testing);
if (testingRoute) return testingRoute;
await persistPhase(beadId, 'Testing', testing.out);
await persistPhaseCheckpoint(beadId, 'Testing', testing.out);

// Auto-write to vault/Solutions so future discover finds this pattern
await persistSolution(
  (a._ ? a._.join(' ') : 'feature'),
  research.out && research.out.synthesis,
  { request: a._ ? a._.join(' ') : a.brief || '', beadId, files: (design && design.affirmed_files) || [] }
);
const proofOfWork = buildProofOfWork({ verdict: 'APPROVE', route: 'done', beadId, implResult, reviewGrade, testing });
await persistPhase(beadId, 'ProofOfWork', proofOfWork);
// Lifecycle: in_progress -> closed (terminal success only). Soft: never aborts the return.
await closeRun(beadId, 'feature complete: APPROVE');
return { verdict: 'APPROVE', route: 'done', impl: implResult.out, review: (reviewGrade && reviewGrade.verdict) || 'BLOCK', testing: testing.out, proofOfWork };
