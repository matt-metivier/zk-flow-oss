// src/workflows/simplify.src.js
// @@USE: run-phase,handoff,budgets,schemas,args,bd-memory,bead-run,ci-loop,model-tiers,operating-posture,guardrails,skill-render,env-check,context-pack
export const meta = {
  name: 'simplify',
  description: 'Standalone simplify pass: applies reuse/dead-code/altitude cleanups to the code AND tightens the PR description (no AI-vocab, no restating the diff), then verifies via CI. Entry: pr=<url-or-number> to target an open PR (checks it out, pushes the cleanup, edits the description); omit pr= to simplify the local working diff only (no push, no description phase).',
  phases: [{title:'Verify'},{title:'Simplify'},{title:'Description'},{title:'CI'}],
};
// @@FRAGMENTS@@

const a = readArgs(args);
const pr = a.pr || null;
// bd preflight: this workflow persists two phase artifacts, and persistPhase against an
// uninitialized bd fails silently. Non-fatal — the cleanup itself is still worth doing.
const _bdOk = await agent(BD_PREFLIGHT_PROMPT, { label: 'preflight:bd', agentType: 'researcher', model: MODEL_TIERS.fast });
const _bdUsable = !!(_bdOk && _bdOk.ok !== false);

const beadId = runBeadId(a);

// Multi-repo workspaces: the session cwd may be a meta-repo with no remote, or the wrong
// repo entirely. Every agent below must locate the PR's actual local clone before any
// git/gh command -- a bare `gh pr checkout` from the wrong directory silently no-ops or
// errors "no git remotes found" (observed failure mode in multi-repo checkouts).
const repoLocatePrefix = pr
  ? `Before any git/gh command: check if the current working directory's \`git remote get-url origin\` matches the repo in ${pr}. If it does not match (or there is no remote), find the correct local clone -- look for a sibling directory whose name matches the PR URL's repo name (e.g. a directory literally named after the repo, one level up or in common workspace roots) and \`cd\` there first. Do not assume the cwd is correct without checking.\n\n`
  : '';

let branch = null;
if (pr) {
  phase('Verify');
  const verified = await agent(
    repoLocatePrefix +
    `Verify PR/MR ${pr} exists and return its source branch name. Use the project VCS CLI (detect from \`git remote get-url origin\`: gh for GitHub, glab for GitLab). GitHub: \`gh pr view ${pr} --json number,headRefName,state\`. GitLab: \`glab mr view ${pr}\`.`,
    { label: 'verify:pr', agentType: 'pr-author', schema: { type: 'object', required: ['exists'], properties: { exists: { type: 'boolean' }, branch: { type: 'string' } } }, model: modelFor('verify', a) }
  );
  if (!verified || !verified.exists) {
    await agent(handoffPrompt('could not verify PR ' + pr, 'check the PR url/number and ensure gh/glab auth is configured'), { label: 'handoff:verify-failed', agentType: 'pr-author', model: modelFor('persist', a) });
    return { verdict: 'needs_human', reason: 'could not verify PR' };
  }
  branch = verified.branch || '(see PR)';
}

// Language/practice skills for the diff (code-simplification, restraint, the repo skill).
const skillsBlock = await selectAndRenderSkills(
  (pr ? `PR ${pr} ` : '') + 'simplify pass: reuse, dead code, over-abstraction, altitude',
  null,
  modelFor('discover', a)
);

// Durable context: machine persona + prior beads + vault MOC (no discover phase here).
const ctxBlock = await contextPack((pr ? `PR ${pr} ` : '') + 'simplify pass', (pr ? String(pr) : 'simplify'), modelFor('discover', a));

// --- SIMPLIFY: single bounded pass, applied directly. Quality only -- no behavior/scope change. ---
phase('Simplify');
const simplifyResult = await runPhase({
  phasePrompt: (i, fb) => repoLocatePrefix +
    (pr && branch !== '(see PR)' ? workspaceBootstrap(beadId, { branch, fetch: true }) + '\n\n' : '') +
    `Simplify pass: review the ${pr ? `PR/MR ${pr}'s diff` : 'current working diff'} for reuse misses (duplicates an existing helper/util -- cite it), unrequested abstraction (single-caller extraction, unused config knob), dead/unreachable code, and altitude mismatches (ceremony disproportionate to the change). Apply the fixes directly. Do NOT change behavior, scope, or public contracts -- this is quality-only, not a bugfix or feature pass. ${fb ? 'Address prior grader feedback: ' + fb : ''}` +
    (pr ? ` After fixing: commit AND git push to the source branch -- the PR only updates when the push lands.` : ` Do not commit or push -- this is a local-only pass.`) +
    skillsBlock + ctxBlock,
  phaseSchema: SCHEMAS.implementation,
  agentType: 'scope-locked-editor',
  isolation: 'worktree',
  label: 'simplify',
  maxIterations: 1,
  model: modelFor('impl', a), gradeModel: modelFor('grade', a),
  gradePrompt: (out) => `Grade this simplify pass: did it reduce duplication/complexity WITHOUT changing behavior, scope, or public contracts? ${pr ? 'Was it committed and pushed?' : ''} Output: ${JSON.stringify(out)}`,
});
if (!simplifyResult.ok) {
  await agent(handoffPrompt('simplify pass did not pass grading', 'investigate manually -- the diff may have needed a behavior change to simplify safely'), { agentType: 'pr-author', label: 'handoff:simplify', model: modelFor('persist', a) });
  return { verdict: 'needs_human', phase: 'simplify' };
}
if (_bdUsable) await persistPhase(beadId, 'Simplify', simplifyResult.out);

// --- DESCRIPTION: tighten the PR description itself (no AI-vocab, no restating the diff). PR-only. ---
if (pr) {
phase('Description');
const descResult = await agent(
  repoLocatePrefix +
  `Tighten PR ${pr}'s description. Fetch the current body (\`gh pr view ${pr} --json body\` or \`glab mr view ${pr}\`). Rewrite it to remove: AI-vocabulary ("this PR introduces/leverages/ensures"), restating what the diff already shows file-by-file, redundant headers, and padding. Keep: the why, any non-obvious tradeoffs, and the test plan. Apply the humanizer skill's rules if \`$ZK_ARTIFACTS_DIR/skills/general/practices/humanizer/SKILL.md\` exists -- no tables, no bold inline headers. Update the description in place (\`gh pr edit ${pr} --body ...\` or \`glab mr update ${pr} --description ...\`). Do NOT change substance -- same facts, tighter prose.`,
  { label: 'description', agentType: 'pr-author', schema: { type: 'object', required: ['updated'], properties: { updated: { type: 'boolean' }, summary: { type: 'string' } } }, model: modelFor('impl', a) }
);
if (_bdUsable) await persistPhase(beadId, 'Description', descResult || { updated: false });
}

// --- CI: only meaningful when a PR was pushed to. ---
if (pr) {
phase('CI');
const ciResult = await runCI({ beadId, budget: PHASE_BUDGETS.ci, implModel: modelFor('impl', a), gradeModel: modelFor('grade', a), agentType: 'pr-author', pr, branch, getImplResult: () => simplifyResult, setImplResult: () => {}, implRerunGuard: false, persistOnGreen: 'after' });
if (!ciResult.passed) return { verdict: 'needs_human', phase: ciResult.phase };
}

return { verdict: 'APPROVE', route: 'done', pr, simplify: simplifyResult.out };
