// src/workflows/research.src.js
// @@USE: run-phase,handoff,budgets,schemas,args,bead-run,model-tiers,env-check,guardrails,skill-render,persona-load,prompt-loader,bd-memory,operating-posture,claim-verify
export const meta = {
  name: 'research',
  description: 'Investigate and STOP: research -> discover. No design or implementation. Use when you need a research synthesis before committing to a solution.',
  phases: [{title:'Research'},{title:'Discover'}],
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
  phasePrompt: (i, fb) => loadPhasePrompt('research', { iteration: i, feedback: fb || null, request: (a._ ? a._.join(' ') : ''), discovery: discovery }),
  phaseSchema: SCHEMAS.research,
  agentType: 'researcher',
  label: 'research',
  maxIterations: PHASE_BUDGETS.research,
  model: modelFor('research', a), gradeModel: modelFor('grade', a),
  posture: postureFor('research', a),
  beadId: beadId,
  gradePrompt: (out) => `Grade this research against the research rubric: ${JSON.stringify(out)}`,
});
if (!research.ok) {
  await agent(handoffPrompt('research did not pass within budget', 'rerun /research or refine the topic'), { agentType: 'pr-author', label: 'handoff:research', model: modelFor('persist', a) });
  return { verdict: 'needs_human', phase: 'research' };
}

// --- VERIFY (abstention-aware adversarial claim quorum before research_complete) ---
// Skeptic voters try to refute each finding; survivors replace key_findings so killed
// claims never reach discover/design. salvagePhase keeps the run if verification is
// skipped or wipes everything out (counts persisted for transparency, not load-bearing).
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

// Persist synthesis to beads
await persistPhase(beadId, 'ResearchSynthesis', research.out);
assertEvidencePresent(research.out, 'Research');
assertEvidenceQuality(research.out, 'Research');

// --- DISCOVER (uses research findings for skill/vault/bead selection) ---
phase('Discover');
discovery = await agent(
  `${postureFor('discover', a)}\n\n${buildPersonaSection()}\n\nCall StructuredOutput with the schema fields at the TOP LEVEL of the tool input — do NOT wrap them in an output key.\nSelect skills, vault paths, and related beads using research findings and persona context. REQUIRED steps (run the shell, do not answer from memory): 1. Skill catalog: run 'cat \"$ZK_ARTIFACTS_DIR/skills/CATALOG.md\"'. You may select skill ids ONLY from this catalog — COPY each id exactly as written between the backticks (do not adjust category dirs from memory; e.g. observability-stack lives under general/tools/, not general/infrastructure/). Any id not in the catalog is invalid. 2. Map of Maps: run 'cat \"$ZK_ARTIFACTS_DIR/vault/Map of Contents/Map of Maps.md\"', pick the MOC matching the task domain, cat that MOC file, cite its path in vault_paths[] and its filename in moc_consulted (or set moc_consulted to no_moc_match). 3. Prior solutions: run 'ls \"$ZK_ARTIFACTS_DIR/vault/Solutions/\" 2>/dev/null | grep -i <keyword>' and cite matches in vault_paths[]. 4. Related beads: run the bounded retrieval below and cite the ids that actually relate (same-subject first, then cross-subject recency):\n\`\`\`\n${bdBoundedContext((a.brief || (a._ ? a._.join(' ') : '')).slice(0, 120), { nSame: 5, nCross: 3 })}\n\`\`\` and cite matching ids in related_beads[]. 5. Validate: every skills[] entry appears verbatim in the catalog; vault_paths[] includes the consulted MOC.\nResearch summary: ${JSON.stringify({key_findings: research.out.key_findings, synthesis: research.out.synthesis})}\nRequest: ${a._ ? a._.join(' ') : '(infer from context)'}`,
  { schema: SCHEMAS.discover, agentType: 'researcher', label: 'discover:1', model: modelFor('discover', a) }
);
await persistPhase(beadId, 'Discover', discovery);
assertDiscoverValid(discovery, 'Discover');
assertSelectedSkillsValid(discovery.skills, 'research');
const skillsBlock = await renderSkills(discovery.skills, modelFor('discover', a));

// Final handoff doc
await agent(handoffPrompt('research complete: ' + JSON.stringify(research.out) + (skillsBlock ? '\n\nSelected skills (rendered for the next phase):' + skillsBlock : ''), 'run /design (pass bead=' + beadId + ') or /feature startAt=discover'), { agentType: 'pr-author', label: 'handoff:research-complete', model: modelFor('persist', a) });

return { verdict: 'research_complete', synthesis: research.out, discovery, bead: beadId };

