// src/workflows/finish-pr.src.js
// @@USE: run-phase,handoff,budgets,schemas,args,bd-memory,bead-run,depth-map,verdict,ci-loop,model-tiers,env-check,guardrails,operating-posture,skill-render,context-pack
export const meta = {
  name: 'finish-pr',
  description: 'Resume/finish an existing PR: verify PR exists, load prior context + unresolved review threads, idempotent pre-impl check, thread-driven impl-fix loop, watch CI, reply+resolve threads, review council, testing. Entry point: pr=<url-or-number>. Optionally bead=<id> to load prior design/research context across the seam.',
  phases: [{title:'Verify'},{title:'Threads'},{title:'Impl'},{title:'CI'},{title:'Review'},{title:'Testing'}],
};
// @@FRAGMENTS@@

const a = readArgs(args);

// Bitbucket MCP helper — parse prId, workspaceId, repoId from URL or integer
const BB_PR_NUM = /^[0-9]+$/.test(String(a.pr)) ? parseInt(a.pr) : parseInt(String(a.pr).match(/\/pull-requests\/([0-9]+)/)?.[1] || '0');
const BB_WORKSPACE = String(a.pr).match(/bitbucket\.org\/([\w.-]+)\//)?.[1] || '';
const BB_SLUG = String(a.pr).match(/bitbucket\.org\/[\w.-]+\/([\w.-]+)\//)?.[1] || '';
// For Bitbucket repos ALWAYS use mcp__atlassian__bitbucketPullRequest — it is already authenticated via the Atlassian MCP.
// Actions: get(prId), diff(prId), comments(prId), comment(prId,content,parentCommentId).

// Guard: bd must be initialized (run: bd init in this directory if not)
const _bdPreflight = await agent(BD_PREFLIGHT_PROMPT, { label: 'preflight:bd', agentType: 'researcher', model: MODEL_TIERS.fast });
if (!_bdPreflight || _bdPreflight.ok === false) {
  const _bdReason = (_bdPreflight && _bdPreflight.reason) || 'bd not initialized — run: cd ~/dev/zk-flow && bd init';
  await agent(handoffPrompt(_bdReason, 'Run: cd ~/dev/zk-flow && bd init, then retry.'), { label: 'handoff:bd-missing', agentType: 'researcher', model: MODEL_TIERS.fast });
  return { verdict: 'needs_human', phase: 'bd-preflight' };
}

const pr = a.pr;
const beadId = runBeadId(a);
const skipReview = a.skipReview === 'true' || a.skipReview === true;

// Guard: pr= is required and must be an integer, a GitHub PR URL, a GitLab MR URL,
// or a Bitbucket PR URL. (closes forge injection vector — no shell metacharacters accepted)
if (!pr) {
  await agent(handoffPrompt('pr= required', 'rerun with pr=<url-or-number> to identify the pull request or merge request to finish'), { label: 'handoff:no-pr', agentType: 'pr-author', model: modelFor('persist', a) });
  return { verdict: 'needs_human', reason: 'pr=<url-or-number> required' };
}
const PR_OK = /^[0-9]+$/.test(String(pr))
  || /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/[0-9]+$/.test(String(pr))
  || /^https:\/\/[\w.-]+(\/[\w.-]+){2,}\/-\/merge_requests\/[0-9]+$/.test(String(pr))
  || /^https:\/\/bitbucket\.org\/[\w.-]+\/[\w.-]+\/pull-requests\/[0-9]+$/.test(String(pr));
if (!PR_OK) {
  await agent(handoffPrompt('pr= value is not a valid PR/MR number or URL', 'rerun with pr=<integer>, pr=<https://github.com/owner/repo/pull/N>, pr=<https://gitlab.host/group/.../project/-/merge_requests/N>, or pr=<https://bitbucket.org/workspace/slug/pull-requests/N>'), { label: 'handoff:invalid-pr', agentType: 'pr-author', model: modelFor('persist', a) });
  return { verdict: 'needs_human', reason: 'pr must be an integer, a GitHub PR URL, a GitLab MR URL, or a Bitbucket PR URL' };
}

// ============================================================
// VERIFY: confirm the PR exists and capture branch/state
// ============================================================
phase('Verify');
const verifySchema = { type: 'object', required: ['exists'], properties: { exists: { type: 'boolean' }, branch: { type: 'string' } } };
const verifyOut = await agent(
  `Verify that pull request/merge request ${pr} exists. Use the project VCS CLI (detect from \`git remote get-url origin\`: gh for GitHub, glab for GitLab, mcp__atlassian__bitbucketPullRequest for Bitbucket). Run: gh pr view ${pr} --json number,title,state,headRefName OR glab mr view ${pr} --output json. Bitbucket: use mcp__atlassian__bitbucketPullRequest(action='get', workspaceId='${BB_WORKSPACE || '<parse from origin URL>'}', repoId='${BB_SLUG || '<parse from origin URL>'}', prId=${BB_PR_NUM || '<parse from URL>'}) — extract source.branch.name for headRefName. Return exists=true and branch=<headRefName> if found, exists=false otherwise.`,
  { label: 'verify:pr', agentType: 'pr-author', schema: verifySchema, model: modelFor('verify', a) }
);
if (!verifyOut || !verifyOut.exists) {
  await agent(handoffPrompt('could not verify PR ' + pr, 'check the PR url/number and ensure gh auth is configured'), { label: 'handoff:verify-failed', agentType: 'pr-author', model: modelFor('persist', a) });
  return { verdict: 'needs_human', reason: 'could not verify PR ' + pr };
}
await persistPhase(beadId, 'Verify', verifyOut);
// Lifecycle: open -> in_progress (PR confirmed to exist).
await claimRun(beadId);

// Sanitize the PR branch before any interpolation — it's attacker-controlled for external PRs.
// Only allow chars safe in shell/prompt contexts; fall back to '(see PR)' on any metacharacter.
const safeBranch = (verifyOut.branch && /^[A-Za-z0-9._\/-]+$/.test(verifyOut.branch)) ? verifyOut.branch : '(see PR)';

// ============================================================
// CONTEXT LOAD: bead-based (schema-validated) or PR-diff-derived
// ============================================================
let priorContext;
let skillsBlock = '';
if (a.bead) {
  // Schema-validated load across the seam, mirroring feature run-2
  const loadedDesign = await agent(
    `From bead ${beadId} (run bd show ${beadId} --json), reconstruct the approved design as a design.json object. Run EXACTLY this shell and return its output:\n\`\`\`\n${bdShow(beadId)}\n\`\`\`\nReturn ONLY the most recent Design entry as a schema-valid design object. If the bead does not exist or contains no Design entry, return null.`,
    { label: 'bd:load-design', agentType: 'researcher', schema: SCHEMAS.design, model: modelFor('verify', a) }
  );
  if (!loadedDesign) {
    await agent(handoffPrompt('load-design failed: no valid design in bead ' + beadId, 'ensure the bead id matches a completed design run'), { label: 'handoff:load-design-failed', agentType: 'pr-author', model: modelFor('persist', a) });
    return { verdict: 'needs_human', reason: 'could not load valid design from bead' };
  }
  const loadedResearch = await agent(
    `From bead ${beadId} (run bd show ${beadId} --json), reconstruct the research synthesis as a research.json object. Run EXACTLY this shell and return its output:\n\`\`\`\n${bdShow(beadId)}\n\`\`\`\nReturn ONLY the most recent Research or ResearchSynthesis entry as a schema-valid research object. If the bead does not exist or contains no Research entry, return null.`,
    { label: 'bd:load-research', agentType: 'researcher', schema: SCHEMAS.research, model: modelFor('verify', a) }
  );
  if (!loadedResearch) {
    await agent(handoffPrompt('load-research failed: no valid research in bead ' + beadId, 'ensure the bead id matches a completed research run'), { label: 'handoff:load-research-failed', agentType: 'pr-author', model: modelFor('persist', a) });
    return { verdict: 'needs_human', reason: 'could not load valid research from bead' };
  }
  priorContext = { design: loadedDesign, research: loadedResearch };
  // The bead's research already carries selected_skills — render them instead of
  // re-selecting. Before this they were loaded and then dropped on the floor.
  assertSelectedSkillsValid(loadedResearch.selected_skills || [], 'finish-pr');
  skillsBlock = await renderSkills(loadedResearch.selected_skills || [], modelFor('verify', a));
  if (!skillsBlock) warnIfSkillsDropped(loadedResearch.selected_skills, 'finish-pr:bead');
} else {
  // No bead: derive context from the PR diff itself
  const diffResearch = await agent(
    `Derive implementation context from PR/MR ${pr}. Use the project VCS CLI (detect from \`git remote get-url origin\`: gh for GitHub, glab for GitLab, mcp__atlassian__bitbucketPullRequest for Bitbucket). Run: gh pr diff ${pr} OR glab mr diff ${pr}. Also run: gh pr view ${pr} --json body,title,comments OR glab mr view ${pr} --output json. Bitbucket: use mcp__atlassian__bitbucketPullRequest(action='diff', workspaceId, repoId, prId) for the diff and mcp__atlassian__bitbucketPullRequest(action='get', workspaceId, repoId, prId) for PR details — parse workspaceId/repoId from origin URL. Synthesize a research-shaped summary of what the PR/MR intends to do, what files it touches, and what checks/feedback are outstanding. Return a schema-valid research object.`,
    { label: 'context:from-diff', agentType: 'researcher', schema: SCHEMAS.research, model: modelFor('research', a) }
  );
  if (!diffResearch) {
    await agent(handoffPrompt('could not derive context from PR diff for ' + pr, 'check gh auth and PR accessibility, or provide bead=<id>'), { label: 'handoff:diff-context-failed', agentType: 'pr-author', model: modelFor('persist', a) });
    return { verdict: 'needs_human', reason: 'could not derive context from PR diff' };
  }
  priorContext = { research: diffResearch };
  skillsBlock = await renderSkills(
    diffResearch.selected_skills || [],
    modelFor('verify', a)
  ) || await selectAndRenderSkills(`PR ${pr}`, diffResearch, modelFor('discover', a));
}

// Durable context: persona + prior beads + MOC. finish-pr reconstructs design/research
// from the bead but had no machine facts at all — which repo's conventions, which CI.
const ctxBlock = await contextPack(`PR ${pr} ${(priorContext.research && priorContext.research.synthesis) || ''}`, String(pr), modelFor('discover', a));

// ============================================================
// THREADS: load unresolved review threads (VCS-aware)
// ============================================================
phase('Threads');
const threadsSchema = {
  type: 'object',
  required: ['threads'],
  properties: {
    threads: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'file', 'comment'],
        properties: {
          id: { type: 'string' },
          file: { type: 'string' },
          line: { type: ['integer', 'null'] },
          comment: { type: 'string' },
          resolved: { type: 'boolean' },
        },
      },
    },
  },
};
const threadsOut = await agent(
  `Fetch all review threads/comments on PR/MR ${pr} and return them structured. Use the project VCS CLI (detect from \`git remote get-url origin\`: gh for GitHub, glab for GitLab, mcp__atlassian__bitbucketPullRequest for Bitbucket). GitHub: run \`gh api repos/{owner}/{repo}/pulls/${pr}/reviews\` then \`gh api repos/{owner}/{repo}/pulls/${pr}/comments\` to get inline thread comments (resolve {owner}/{repo} from \`git remote get-url origin\`). GitLab: run \`glab mr notes ${pr}\` or \`glab api projects/{id}/merge_requests/${pr}/discussions\`. Bitbucket: use mcp__atlassian__bitbucketPullRequest(action='comments', workspaceId, repoId, prId) — parse workspaceId/repoId from origin URL; use comment id as thread id, inline.path as file, inline.to as line; Bitbucket has no formal resolve state so treat all non-deleted comments as unresolved. Return a threads array where each item has id (string), file (filename or empty string for general comments), line (line number or null), comment (the reviewer comment body), resolved (true if the thread is already marked resolved/outdated, false otherwise). Include ALL threads, resolved or not — the caller will filter.`,
  { label: 'threads:load', agentType: 'pr-author', schema: threadsSchema, model: modelFor('verify', a) }
);
const allThreads = (threadsOut && Array.isArray(threadsOut.threads)) ? threadsOut.threads : [];
const unresolvedThreads = allThreads.filter(t => !t.resolved);
await persistPhase(beadId, 'Threads', { total: allThreads.length, unresolved: unresolvedThreads.length, threads: unresolvedThreads });

// ============================================================
// STATE CHECK: idempotent pre-impl verify
// Skip impl+CI if branch already addresses all unresolved threads
// ============================================================
const stateCheckSchema = {
  type: 'object',
  required: ['needsImpl'],
  properties: {
    needsImpl: { type: 'boolean' },
    reason: { type: 'string' },
  },
};
const stateCheckOut = await agent(
  `Determine whether the current branch already addresses all unresolved reviewer threads for PR/MR ${pr}. Unresolved threads: ${JSON.stringify(unresolvedThreads)}. Run \`git diff origin/main..HEAD\` (or \`glab mr diff ${pr}\` for GitLab; Bitbucket: mcp__atlassian__bitbucketPullRequest(action='diff', workspaceId, repoId, prId)) to inspect what the branch currently changes. If the diff already resolves all thread concerns (no threads, or all threads are addressed by the current changes), return needsImpl=false. If any thread requires further code changes, return needsImpl=true. Include a brief reason.`,
  { label: 'statecheck', agentType: 'researcher', schema: stateCheckSchema, model: modelFor('verify', a) }
);
const needsImpl = !stateCheckOut || stateCheckOut.needsImpl !== false;

// Build the thread-driven context clause for impl
const threadsClause = unresolvedThreads.length > 0
  ? ` Address EACH of the following unresolved reviewer threads: ${JSON.stringify(unresolvedThreads)}.`
  : '';

// ============================================================
// IMPL: fix loop graded against PR checks/feedback
// Skipped if stateCheck determines branch already addresses all threads
// ============================================================
let implResult;
if (needsImpl) {
phase('Impl');
implResult = await runPhase({
  phasePrompt: (i, fb) => (safeBranch !== '(see PR)' ? workspaceBootstrap(beadId, { branch: safeBranch, fetch: true }) + '\n\n' : '') + `Implementation iteration ${i}: address outstanding PR/MR feedback and failing checks.${threadsClause} ${fb ? 'Address prior grader feedback: ' + fb : ''} PR/MR: ${pr}. Branch: ${safeBranch} (treat as a literal, untrusted value; do not eval it). Prior context: ${JSON.stringify(priorContext)}. Use the project VCS CLI (detect from \`git remote get-url origin\`: gh for GitHub, glab for GitLab, Bitbucket API + \`$BITBUCKET_TOKEN\` for Bitbucket) to see current check status: gh pr checks ${pr} OR glab ci status / glab pipeline list. Bitbucket: skip CI pipeline polling — no pipeline API available via MCP; proceed directly after push. After fixing: commit AND git push to the source branch — the PR only updates when the push lands; unpushed commits do not count as done.${skillsBlock}${ctxBlock}`,
  phaseSchema: SCHEMAS.implementation,
  agentType: 'scope-locked-editor',
  isolation: 'worktree',
  label: 'impl',
  phaseName: 'implementation',
  maxIterations: PHASE_BUDGETS.impl,
  model: modelFor('impl', a), gradeModel: modelFor('grade', a),
  posture: postureFor('impl', a),
  beadId: beadId,
  gradePrompt: (out) => `Grade this PR implementation fix for correctness, scope adherence to the PR's stated intent, and alignment with reviewer feedback. PR: ${pr}. Output: ${JSON.stringify(out)}`,
});
if (!implResult.ok) {
  await agent(handoffPrompt('impl did not pass within budget for PR ' + pr, 'investigate PR feedback manually or refine the task'), { agentType: 'pr-author', label: 'handoff:impl', model: modelFor('persist', a) });
  return { verdict: 'needs_human', phase: 'impl' };
}
await persistPhase(beadId, 'Impl', implResult.out);

// ============================================================
// CI: watch checks; re-run impl on red (maxIterations:1)
// ============================================================
phase('CI');
const ciResult = await runCI({ beadId, budget: PHASE_BUDGETS.ci, implModel: modelFor('impl', a), gradeModel: modelFor('grade', a), agentType: 'pr-author', pr, branch: safeBranch, getImplResult: () => implResult, setImplResult: (r) => { implResult = r; }, implRerunGuard: true, persistOnGreen: 'loop' });
if (!ciResult.passed) return { verdict: 'needs_human', phase: ciResult.phase };
} else {
  // Branch already addresses all threads — skip impl+CI budget
  implResult = { ok: true, out: { outcome: 'skipped: branch already addresses all unresolved reviewer threads (stateCheck needsImpl=false)', files_changed: [], commits: [], tests_run: 0, tests_passed: 0, tests_failed: 0, approach_rationale: stateCheckOut ? stateCheckOut.reason : 'pre-impl verify determined no impl needed' } };
  await persistPhase(beadId, 'ImplSkipped', { reason: stateCheckOut ? stateCheckOut.reason : 'stateCheck returned needsImpl=false' });
}

// ============================================================
// REPLY + RESOLVE THREADS: post per-thread reply and mark resolved
// ============================================================
if (unresolvedThreads.length > 0) {
  await agent(
    `For each of the following reviewer threads on PR/MR ${pr}, post a short reply explaining how it was addressed in the current implementation, then mark the thread as resolved. Threads: ${JSON.stringify(unresolvedThreads)}. Implementation summary: ${JSON.stringify(implResult.out)}. Use the project VCS CLI (detect from \`git remote get-url origin\`: gh for GitHub, glab for GitLab, Bitbucket API + \`$BITBUCKET_TOKEN\` for Bitbucket). GitHub: use \`gh api repos/{owner}/{repo}/pulls/${pr}/reviews/{review_id}/dismissals\` or \`gh api -X POST repos/{owner}/{repo}/pulls/comments/{comment_id}/replies\` for replies; use the GraphQL API (gh api graphql) with the \`resolveReviewThread\` mutation to mark threads resolved. GitLab: use \`glab api -X PUT projects/{id}/merge_requests/${pr}/discussions/{discussion_id}?resolved=true\` to resolve each thread. Bitbucket: use mcp__atlassian__bitbucketPullRequest(action='comment', workspaceId, repoId, prId, content="<reply>", parentCommentId=<comment_id>) for each reply — parse workspaceId/repoId from origin URL. Bitbucket has no formal thread-resolve API — a reply is sufficient. Be concise: one sentence per thread reply.`,
    { label: 'threads:reply-resolve', agentType: 'pr-author', model: modelFor('verify', a) }
  );
  await persistPhase(beadId, 'ThreadsResolved', { count: unresolvedThreads.length, threads: unresolvedThreads.map(t => t.id) });
}

// ============================================================
// REVIEW: inline council; re-runs impl on REQUEST_CHANGES
// TODO: DRY with feature (review-loop fragment; deferred — see ci-loop.js)
// ============================================================
phase('Review');
let reviewGrade, reviewRoute;
if (skipReview) {
  reviewGrade = { verdict: 'APPROVE', findings: [], note: 'review skipped via skipReview=true' };
  reviewRoute = 'done';
} else {
for (let ri = 1; ri <= PHASE_BUDGETS.council; ri++) {
  const reviewPersp = await parallel(validPerspectives(a.perspectives ? a.perspectives.split(',') : DEFAULT_PERSPECTIVES).map(p => () =>
    agent(
      `${postureFor('review', a)}\n\nReview the implementation from the "${p}" perspective. PR/MR: ${pr}. Use the project VCS CLI (detect from \`git remote get-url origin\`: gh for GitHub, glab for GitLab, Bitbucket API + \`$BITBUCKET_TOKEN\` for Bitbucket): run gh pr diff ${pr} OR glab mr diff ${pr} to see the diff. Bitbucket: use mcp__atlassian__bitbucketPullRequest(action='diff', workspaceId, repoId, prId). Impl: ${JSON.stringify(implResult.out)}`,
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
      phasePrompt: (i, fb) => `Impl re-run iteration ${i} to address review findings. ${fb ? 'Address grader feedback: ' + fb : ''} Review feedback: ${JSON.stringify(reviewGrade)}. Prior impl: ${JSON.stringify(implResult.out)}. After fixing: commit AND git push to the source branch — unpushed commits do not count as done.`,
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
await persistPhase(beadId, 'ReviewGrade', reviewGrade);
await agent(`Persist GraderFeedback for improve. Run EXACTLY this shell, then report done:\n\`\`\`\n${bdWrite('improve', 'GraderFeedback', { phase: 'review', verdict: (reviewGrade && reviewGrade.verdict) || 'BLOCK', findings: reviewGrade })}\n\`\`\``, { label: 'persist:graderfeedback:review', agentType: 'researcher', model: modelFor('persist', a) });
if (reviewRoute !== 'done') {
  await agent(handoffPrompt('review did not pass', 'investigate review findings manually'), { agentType: 'pr-author', label: 'handoff:review', model: modelFor('persist', a) });
  return { verdict: 'needs_human', phase: 'review' };
}

// ============================================================
// TESTING
// ============================================================
phase('Testing');
const targetEnv = a.targetEnv || 'local';
// finish-pr has NO discover phase, so test agents never receive the rendered
// repo skill that carries the per-repo test recipe. Inject the recipe pointer
// directly so test-runner sets up secrets/DB/env before running — otherwise a
// missing local rig (e.g. /etc/<service>/secrets.yml, no postgres) surfaces as a
// false testing_failed and the council REQUEST_CHANGES on phantom failures (zk-flow-7j4).
const testEnvRecipeClause = `Before running tests, set up the per-repo test environment: derive the repo name from \`git remote get-url origin\`, resolve this machine via \`bd config get host\`, and read the repo test recipe at \`$ZK_ARTIFACTS_DIR/skills/agent/machines/<host>/repos/<repo>/layers/gotchas.md\` (and SKILL.md). Apply any env/setup it documents (e.g. a secrets path like /etc/<svc>/secrets.yml or <org>_SECRETS_PATH, a local postgres port) so tests do not fail on missing infrastructure. If the recipe or the required local infra is genuinely unavailable in this environment, report outcome=smoke_unsupported (NOT testing_failed) — a missing local test rig is not a code defect.`;
const testing = await runPhase({
  phasePrompt: (i, fb) => `Testing iteration ${i}: verify the PR's changes work correctly in '${targetEnv}' environment. Write and run tests. ${testEnvRecipeClause} ${fb ? 'Address prior grader feedback: ' + fb : ''} Impl: ${JSON.stringify(implResult.out)}. Review grade: ${JSON.stringify(reviewGrade)}.`,
  phaseSchema: SCHEMAS.testing,
  agentType: 'test-runner',
  label: 'testing',
  maxIterations: PHASE_BUDGETS.testing,
  model: modelFor('testing', a), gradeModel: modelFor('grade', a),
  posture: postureFor('testing', a),
  beadId: beadId,
  gradePrompt: (out) => `Grade this testing output for coverage, evidence that the PR's changes work correctly, and absence of regressions. Output: ${JSON.stringify(out)}`,
});
if (!testing.ok) {
  await agent(handoffPrompt('testing did not pass within budget', 'investigate test failures manually'), { agentType: 'pr-author', label: 'handoff:testing', model: modelFor('persist', a) });
  return { verdict: 'needs_human', phase: 'testing' };
}
await persistPhase(beadId, 'Testing', testing.out);

// Seed vault/Solutions so future discover phases find this run's outcome.
await persistSolution((a._ ? a._.join(' ') : 'finish-pr'), (typeof research !== 'undefined' && research && research.out && research.out.synthesis) || 'completed', { request: (a._ ? a._.join(' ') : ''), beadId });

// Lifecycle: in_progress -> closed (terminal success only).
await closeRun(beadId, 'finish-pr complete: APPROVE');
return { verdict: 'APPROVE', pr, bead: beadId };
