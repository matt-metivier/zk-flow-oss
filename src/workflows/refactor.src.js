// @@USE: run-phase,backtrack,handoff,budgets,schemas,args,bead-run,model-tiers,env-check,guardrails,prompt-loader,bd-memory,skill-render,persona-load,operating-posture
export const meta = {
  name: 'refactor',
  description: 'Refactor lifecycle: research -> discover -> refactor -> test. Restructures code WITHOUT behavior change.',
  phases: [{title:'Research'},{title:'Discover'},{title:'Refactor'},{title:'Test'}],
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

// Lifecycle: open -> in_progress.
await claimRun(beadId);

// --- RESEARCH ---
phase('Research');
// runResearch is re-runnable so REFACTOR can backtrack to it (runWithBacktrack below).
const runResearch = (backtrackSeed) => runPhase({
  phasePrompt: (i, fb) => loadPhasePrompt('research', { iteration: i, feedback: fb || null, request: 'REFACTOR blast-radius mapping: ' + (a._ ? a._.join(' ') : '') + (backtrackSeed ? `\n\nPrior refactor attempt failed; re-map blast-radius / call sites with this in mind: ${backtrackSeed}` : ''), discovery: discovery }),
  phaseSchema: SCHEMAS.research,
  agentType: 'researcher',
  label: 'research',
  maxIterations: PHASE_BUDGETS.research,
  model: modelFor('research', a), gradeModel: modelFor('grade', a),
  posture: postureFor('research', a),
  beadId: beadId,
  gradePrompt: (out) => `Grade this research output for completeness, blast-radius coverage, and call-site enumeration. Reject if any caller/callee is unaccounted for. Output: ${JSON.stringify(out)}`,
});
let research = await runResearch(null);
if (!research.ok) {
  await agent(handoffPrompt('research did not pass within budget', 'rerun /refactor or narrow the refactor target'), { agentType: 'pr-author', label: 'handoff:research', model: modelFor('persist', a) });
  return { verdict: 'needs_human', phase: 'research' };
}
await persistPhase(beadId, 'Research', research.out);
await persistArtifact(beadId, 'ResearchDoc', '$TMPDIR/research.md');
assertEvidencePresent(research.out, 'Research');

// --- DISCOVER (uses research findings for skill/vault/bead selection) ---
phase('Discover');
discovery = await agent(
  `${postureFor('discover', a)}\n\n${buildPersonaSection()}\nCall StructuredOutput with the schema fields at the TOP LEVEL of the tool input — do NOT wrap them in an output key.\nSelect skills, vault paths, and related beads using research findings and persona context. REQUIRED steps (run the shell, do not answer from memory): 1. Skill catalog: run 'cat \"$ZK_ARTIFACTS_DIR/skills/CATALOG.md\"'. You may select skill ids ONLY from this catalog — COPY each id exactly as written between the backticks. Any id not in the catalog is invalid. 2. Map of Maps: run 'cat \"$ZK_ARTIFACTS_DIR/vault/Map of Contents/Map of Maps.md\"', pick the MOC matching the task domain, cite its path in vault_paths[] and filename in moc_consulted (or no_moc_match). 3. Related beads: run the bounded retrieval below and cite the ids that actually relate (same-subject first, then cross-subject recency):\n\`\`\`\n${bdBoundedContext((a._ ? a._.join(' ') : '').slice(0, 120), { nSame: 5, nCross: 3 })}\n\`\`\`\nResearch summary: ${JSON.stringify({key_findings: research.out.key_findings, synthesis: research.out.synthesis})}\nRequest: ${a._ ? a._.join(' ') : '(infer from context)'}`,
  { schema: SCHEMAS.discover, agentType: 'researcher', label: 'discover:1', model: modelFor('discover', a) }
);
await persistPhase(beadId, 'Discover', discovery);
assertDiscoverValid(discovery, 'Discover');
assertSelectedSkillsValid(discovery.skills, 'refactor');
const skillsBlock = await renderSkills(discovery.skills, modelFor('discover', a));

// --- REFACTOR ---
phase('Refactor');
// runRefactor reads research.out at call time, so a backtracked re-mapping flows in.
const runRefactor = () => runPhase({
  phasePrompt: (i, fb) => loadPhasePrompt('implementation', { iteration: i, feedback: fb || null, request: (a._ ? a._.join(' ') : ''), research: research.out, design: discovery, skills: skillsBlock || '' }),
  phaseSchema: SCHEMAS.implementation,
  agentType: 'scope-locked-editor',
  isolation: 'worktree',
  label: 'refactor',
  phaseName: 'implementation',
  maxIterations: PHASE_BUDGETS.impl,
  model: modelFor('impl', a), gradeModel: modelFor('grade', a),
  posture: postureFor('impl', a),
  beadId: beadId,
  gradePrompt: (out) => `Grade this refactor against the implementation rubric AND behavior-preservation: verify all call sites from research are updated, no public contracts changed, no behavior altered. Output: ${JSON.stringify(out)}`,
});
// Backtrack: if refactor exhausts its budget, re-map blast-radius (up to
// PHASE_BUDGETS.backtrack times, default 0 = off) before needs_human.
const reResearch = async (fb) => { research = await runResearch(fb); return research; };
const refactorResult = await runWithBacktrack(reResearch, runRefactor, { budget: PHASE_BUDGETS.backtrack, label: 'refactor' });
if (!refactorResult.ok) {
  await agent(handoffPrompt('refactor did not pass within budget', 'rerun /refactor or investigate manually'), { agentType: 'pr-author', label: 'handoff:refactor', model: modelFor('persist', a) });
  return { verdict: 'needs_human', phase: 'refactor' };
}
await persistPhase(beadId, 'Refactor', refactorResult.out);

// --- TEST ---
phase('Test');
const targetEnv = a.targetEnv || 'local';
const testResult = await runPhase({
  phasePrompt: (i, fb) => loadPhasePrompt('testing', { iteration: i, feedback: fb || null, request: 'verify UNCHANGED behavior after refactor', design: refactorResult.out, research: research.out }),
  phaseSchema: SCHEMAS.testing,
  agentType: 'test-runner',
  label: 'testing',
  maxIterations: PHASE_BUDGETS.testing,
  model: modelFor('testing', a), gradeModel: modelFor('grade', a),
  posture: postureFor('testing', a),
  beadId: beadId,
  gradePrompt: (out) => `Grade this test run: confirm the suite passes and no test changed semantics. Output: ${JSON.stringify(out)}`,
});
if (!testResult.ok) {
  await agent(handoffPrompt('testing did not pass within budget', 'rerun /refactor or investigate test failures manually'), { agentType: 'pr-author', label: 'handoff:testing', model: modelFor('persist', a) });
  return { verdict: 'needs_human', phase: 'testing' };
}
await persistPhase(beadId, 'Test', testResult.out);

// Seed vault/Solutions so future discover phases find this run's outcome.
await persistSolution((a._ ? a._.join(' ') : 'refactor'), (typeof research !== 'undefined' && research && research.out && research.out.synthesis) || 'completed', { request: (a._ ? a._.join(' ') : ''), beadId });

// Lifecycle: in_progress -> closed (terminal success only).
await closeRun(beadId, 'refactor complete: APPROVE');
return { verdict: 'APPROVE', bead: beadId };
