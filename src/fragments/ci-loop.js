// src/fragments/ci-loop.js
// Bounded CI-watch loop with impl re-run on red.
// Parameterized to handle the three callers' differences:
//   feature: agentType='evidence-scanner', no pr -> LOCAL test gate, persist inside loop, has ok guard
//   small-feature:  agentType='evidence-scanner', no pr -> LOCAL test gate, persist after loop, no ok guard
//   finish-pr:   agentType='pr-author', pr set -> remote PR/MR CI watch, persist inside loop, has ok guard
//
// CI signal source depends on `pr`: when set, watch remote PR/MR checks; when
// absent (local-first run), run the project's local test command and treat
// exit 0 as green. This lets feature/small-feature complete e2e without a pushed PR.
//
// Parameters:
//   beadId       - bead id for persistence
//   budget       - PHASE_BUDGETS.ci
//   agentType    - agent type for the CI check call
//   pr           - optional PR number/url; if set, injected into 'gh pr checks ${pr} --watch'
//   branch       - optional source branch (finish-pr); used to enter the PR-branch worktree
//                  on CI-fix re-runs. Local runs (no pr) bootstrap the per-bead worktree.
//   getImplResult - () => current implResult (read access, for CI-fix prompt)
//   setImplResult - (r) => void (write access, so caller's implResult updates on re-run)
//   implRerunGuard - true (default) = return needs_human if ci-fix impl fails; false = keep looping
//   persistOnGreen - 'loop' (default) = persistPhase CIPassed inside loop with {iterations:ci};
//                    'after' = persistPhase CIPassed after loop with {ok:true}
export async function runCI({ beadId, budget, agentType, pr, branch = null, getImplResult, setImplResult, implRerunGuard = true, persistOnGreen = 'loop', implModel, gradeModel }) {
  const ciSchema = { type: 'object', required: ['green'], properties: { green: { type: 'boolean' }, summary: { type: 'string' } } };
  const prClause = pr ? `${pr} ` : '';
  // CI-fix re-runs invoke scope-locked-editor, which MUST run inside the run's
  // worktree or its commits land in an uncontrolled CWD and are lost (zk-flow-ts2).
  // Local runs (feature/small-feature, no pr) share the deterministic per-bead worktree;
  // finish-pr re-enters the PR source branch (mirrors finish-pr's initial impl).
  const ciFixBootstrap = pr
    ? ((branch && branch !== '(see PR)') ? workspaceBootstrap(beadId, { branch, fetch: true }) + '\n\n' : '')
    : workspaceBootstrap(beadId) + '\n\n';
  let ciPassed = false;
  for (let ci = 1; ci <= budget; ci++) {
    // When a PR exists, watch its remote CI. Otherwise (local-first feature/small-feature
    // run with no pushed PR) fall back to the project's local test gate — without
    // this, the CI agent can never observe green and the run stalls at needs_human.
    const ciPrompt = pr
      ? `CI check iteration ${ci}: watch remote CI for the PR/MR and report status. FIRST detect the host: run \`git remote get-url origin\`.
- GitHub (url contains github.com): run \`gh pr checks ${prClause}--watch\` — it waits for checks; exit 0 means all green.
- GitLab (url contains gitlab.com OR any self-hosted GitLab host): run \`glab ci status --branch "$(git rev-parse --abbrev-ref HEAD)"\` (or \`glab pipeline status\`); if \`glab\` is not installed, query the GitLab pipelines REST API with curl and \`$GITLAB_TOKEN\` (GET /projects/:id/pipelines?ref=<branch>).
- Bitbucket (url contains bitbucket.org): parse workspace/slug from origin URL, then poll \`curl -s -H "Authorization: Bearer $BITBUCKET_TOKEN" "https://api.bitbucket.org/2.0/repositories/{workspace}/{slug}/pipelines/?q=target.commit.hash=\\"$(git rev-parse HEAD)\\""\` — check \`.values[].state.name\` (COMPLETED=done) and \`.values[].state.result.name\` (SUCCESSFUL=green, FAILED/ERROR=red). Poll up to 3 times with 10s sleep between attempts if still IN_PROGRESS.
Return green=true ONLY if ALL checks/pipelines pass; green=false if any fail or are still pending-failed. Put failing check/pipeline names in summary.`
      : `CI check iteration ${ci}: no PR/remote CI for this run — verify against the LOCAL gate instead. Run the project's local test command from the repo root (\`npm test\`; if package.json or README documents a different command, use that). Return green=true ONLY if it exits 0 (all tests pass), green=false otherwise. Put the failing test output in summary when green=false.`;
    const ciOut = await agent(
      ciPrompt,
      { label: `ci:${ci}`, agentType, schema: ciSchema }
    );
    if (ciOut && ciOut.green) {
      ciPassed = true;
      if (persistOnGreen === 'loop') await persistPhase(beadId, 'CIPassed', { iterations: ci });
      break;
    }
    if (ci < budget) {
      const implResult = await runPhase({
        phasePrompt: (i, fb) => ciFixBootstrap + `Impl re-run iteration ${i} after CI failure. ${fb ? 'Address grader feedback: ' + fb : ''} CI output: ${JSON.stringify(ciOut)}. ${pr ? 'Fix failing checks, then commit AND git push to the branch — remote CI only re-runs on pushed commits.' : 'Fix the failing tests, then ensure `npm test` passes locally (no push needed — this run verifies against the local gate).'} Prior impl: ${JSON.stringify(getImplResult().out)}`,
        phaseSchema: SCHEMAS.implementation,
        agentType: 'scope-locked-editor',
        isolation: 'worktree',
        label: `impl:ci-fix:${ci}`,
        maxIterations: 1,
        beadId: beadId,
        model: implModel, gradeModel: gradeModel,
        phaseName: 'implementation',
        gradePrompt: (out) => `Grade this CI-fix implementation. Output: ${JSON.stringify(out)}`,
      });
      if (implRerunGuard && !implResult.ok) {
        await agent(handoffPrompt('CI-fix impl failed within budget', 'investigate failing checks manually'), { agentType: 'pr-author', label: 'handoff:ci-fix' });
        return { passed: false, earlyExit: true, phase: 'ci-fix' };
      }
      setImplResult(implResult);
      await persistPhase(beadId, 'CIFix', { ci, implResult: implResult.out });
    }
  }
  if (!ciPassed) {
    await agent(handoffPrompt('CI did not pass within budget', 'investigate failing checks manually'), { agentType: 'pr-author', label: 'handoff:ci' });
    return { passed: false, earlyExit: false, phase: 'ci' };
  }
  if (persistOnGreen === 'after') await persistPhase(beadId, 'CIPassed', { ok: true });
  return { passed: true };
}
