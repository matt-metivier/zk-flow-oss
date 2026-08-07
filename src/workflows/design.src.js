// src/workflows/design.src.js
// @@USE: run-phase,handoff,depth-map,verdict,budgets,schemas,args,bead-run,model-tiers,env-check,guardrails,skill-render,persona-load,prompt-loader,bd-memory,operating-posture,claim-verify,findings-route
export const meta = {
  name: 'design',
  description: 'Discover + research + design panel with handoff boundary to feature impl',
  phases: [{title:'Research'},{title:'Discover'},{title:'Design'},{title:'Handoff'}],
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


const beadId = runBeadId(a);
let discovery;

// --- RESEARCH ---
phase('Research');
const research = await runPhase({
  phasePrompt: (i, fb) => loadPhasePrompt('research', { iteration: i, feedback: fb || null, request: (a._ ? a._.join(' ') : '') }),
  phaseSchema: SCHEMAS.research,
  agentType: 'researcher',
  label: 'research',
  maxIterations: PHASE_BUDGETS.research,
  model: modelFor('research', a), gradeModel: modelFor('grade', a),
  posture: postureFor('research', a),
  beadId: beadId,
  gradePrompt: (out) => `Grade this research output for completeness, evidence quality, and relevance to the design task. Output: ${JSON.stringify(out)}`,
});
if (!research.ok) {
  await agent(handoffPrompt('research did not pass within budget', 'rerun /design or refine the request'), { label: 'handoff:research', model: modelFor('persist', a) });
  return { verdict: 'needs_human', phase: 'research' };
}
// --- VERIFY (adversarial claim quorum before research feeds design) ---
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
await persistArtifact(beadId, 'ResearchDoc', '$TMPDIR/research.md');
assertEvidencePresent(research.out, 'Research');
assertRequiredFields(research.out, ['key_findings', 'synthesis'], 'Research');
assertEvidenceQuality(research.out, 'Research');

// --- DISCOVER ---
phase('Discover');
discovery = await agent(
  `${postureFor('discover', a)}\n\n${buildPersonaSection()}\n\nCall StructuredOutput with the schema fields at the TOP LEVEL of the tool input — do NOT wrap them in an output key.\nSelect skills, vault paths, and related beads using research findings and persona context. REQUIRED steps (run the shell, do not answer from memory): 1. Skill catalog: run 'cat \"$ZK_ARTIFACTS_DIR/skills/CATALOG.md\"'. You may select skill ids ONLY from this catalog — COPY each id exactly as written between the backticks (do not adjust category dirs from memory; e.g. observability-stack lives under general/tools/, not general/infrastructure/). Any id not in the catalog is invalid. 2. Map of Maps: run 'cat \"$ZK_ARTIFACTS_DIR/vault/Map of Contents/Map of Maps.md\"', pick the MOC matching the task domain, cat that MOC file, cite its path in vault_paths[] and its filename in moc_consulted (or set moc_consulted to no_moc_match). 3. Prior solutions: run 'ls \"$ZK_ARTIFACTS_DIR/vault/Solutions/\" 2>/dev/null | grep -i <keyword>' and cite matches in vault_paths[]. 4. Related beads: run the bounded retrieval below and cite the ids that actually relate (same-subject first, then cross-subject recency):\n\`\`\`\n${bdBoundedContext((a.brief || (a._ ? a._.join(' ') : '')).slice(0, 120), { nSame: 5, nCross: 3 })}\n\`\`\` and cite matching ids in related_beads[]. 5. Validate: every skills[] entry appears verbatim in the catalog; vault_paths[] includes the consulted MOC.\nResearch summary: ${JSON.stringify({key_findings: research.out.key_findings, synthesis: research.out.synthesis})}\nRequest: ${a._ ? a._.join(' ') : '(infer from context)'}`,
  { schema: SCHEMAS.discover, agentType: 'researcher', label: 'discover:1', model: modelFor('discover', a) }
);
await persistPhase(beadId, 'Discover', discovery);
assertDiscoverValid(discovery, 'Discover');
assertSelectedSkillsValid(discovery.skills, 'design');
const skillsBlock = await renderSkills(discovery.skills, modelFor('discover', a));

// --- VALIDATION CONTRACT (before design defines its approach — two-level TDD) ---
// Success criteria written BEFORE the approach so they are not biased by the planned
// implementation. salvagePhase keeps the run if the contract agent returns null.
phase('Design');
const contract = salvagePhase(await agent(
  loadPhasePrompt('validation-contract', { request: (a._ ? a._.join(' ') : ''), research: research.out }),
  { schema: SCHEMAS['validation-contract'], agentType: 'designer', label: 'validation-contract', model: modelFor('design', a) }
), 'ValidationContract');
const _contract = (contract && !contract.skipped) ? contract : null;
if (_contract) await persistPhaseSoft(beadId, 'ValidationContract', _contract);

// --- DESIGN PANEL (with perspectives inside the loop) ---
// designer draft — the validation contract is injected via ctx.contract so the approach
// is chosen to satisfy it.
let design = await agent(
  `${postureFor('design', a)}\n\nDraft the design for this feature. Use SQCA format (Summary, Questions, Context, Approach). Research: ${JSON.stringify(research.out)}. Request: ${a._ ? a._.join(' ') : ''}${_contract ? '\n\n## Validation contract (your approach MUST satisfy every assertion)\n' + JSON.stringify(_contract) : ''}${skillsBlock ? '\n\n' + skillsBlock : ''}`,
  { schema: SCHEMAS.design, agentType: 'designer', label: 'designer:1', model: modelFor('design', a) }
);

// adversarial pass (parallel, one-shot)
const [devil, grillOut] = await parallel([
  () => agent(
    `${postureFor('grill', a)}\n\nDevil's advocate: fastest single-perspective stress test of this design: ${JSON.stringify(design)}`,
    { label: 'devils-advocate', agentType: 'devils-advocate', model: modelFor('grill', a) }
  ),
  () => agent(
    `${postureFor('grill', a)}\n\nGrill this design (one-shot): ${JSON.stringify(design)}. Output challenges[].`,
    { label: 'griller', agentType: 'griller', model: modelFor('grill', a) }
  ),
]);

// designer response to objections
design = await agent(
  `${postureFor('design', a)}\n\nUpdate the design addressing these objections.\nDevil: ${JSON.stringify(devil)}\nGrill: ${JSON.stringify(grillOut)}\nDesign: ${JSON.stringify(design)}`,
  { schema: SCHEMAS.design, agentType: 'designer', label: 'designer:response', model: modelFor('design', a) }
);

// perspective council: loop with perspectives INSIDE so each revision is re-reviewed
let grade, designApproved = false;
for (let di = 1; di <= PHASE_BUDGETS.design; di++) {
  const persp = await parallel(validPerspectives(DEFAULT_PERSPECTIVES).map(p => () =>
    agent(
      `${postureFor('review', a)}\n\nReview the design from the "${p}" perspective: ${JSON.stringify(design)}`,
      { label: `design-council:${p}:${di}`, agentType: p, model: modelFor('review', a) }
    )
  ));
  grade = await agent(
    `${postureFor('grade', a)}\n\nGrader: synthesize design verdict from perspective reviews (iteration ${di}): ${JSON.stringify(persp.filter(Boolean))}`,
    { schema: SCHEMAS.review, agentType: 'grader', label: `grader:design:${di}`, model: modelFor('grade', a) }
  );
  // Persist GraderFeedback every iteration (mirrors run-phase.js / feature design
  // loop) so /improve sees design failures and a needs_human exit records WHY.
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

await persistPhase(beadId, 'DesignGrade', grade);
await persistArtifact(beadId, 'DesignDoc', '$TMPDIR/design.md');


// --- HANDOFF ---
phase('Handoff');
const handoffMsg = `Design complete and ready for implementation. Pass bead=${beadId} to the next run so it can load prior context.\nSuggested next workflow: /feature startAt=impl bead=${beadId}\nHuman must review and approve the design before resuming.\nDesign verdict: ${JSON.stringify(grade)}.\nDesign: ${JSON.stringify(design)}.\nRedact any secrets or credentials.`;
const handoff = await agent(handoffPrompt(handoffMsg, `/feature startAt=impl bead=${beadId}`), { agentType: 'pr-author', label: 'handoff:design-complete', model: modelFor('persist', a) });

return { design, verdict: grade ? grade.verdict : 'BLOCK', route: routeVerdict(grade ? grade.verdict : 'BLOCK'), handoff };
