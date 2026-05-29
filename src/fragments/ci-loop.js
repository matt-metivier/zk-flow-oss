// src/fragments/ci-loop.js
// Bounded CI-watch loop with impl re-run on red.
// Parameterized to handle the three callers' differences:
//   feature: agentType='evidence-scanner', no pr in prompt, persist inside loop, has ok guard
//   bugfix:  agentType='evidence-scanner', no pr in prompt, persist after loop, no ok guard
//   finish-pr:   agentType='pr-author', pr in prompt, persist inside loop, has ok guard
//
// Parameters:
//   beadId       - bead id for persistence
//   budget       - PHASE_BUDGETS.ci
//   agentType    - agent type for the CI check call
//   pr           - optional PR number/url; if set, injected into 'gh pr checks ${pr} --watch'
//   getImplResult - () => current implResult (read access, for CI-fix prompt)
//   setImplResult - (r) => void (write access, so caller's implResult updates on re-run)
//   implRerunGuard - true (default) = return needs_human if ci-fix impl fails; false = keep looping
//   persistOnGreen - 'loop' (default) = persistPhase CIPassed inside loop with {iterations:ci};
//                    'after' = persistPhase CIPassed after loop with {ok:true}
export async function runCI({ beadId, budget, agentType, pr, getImplResult, setImplResult, implRerunGuard = true, persistOnGreen = 'loop' }) {
  const ciSchema = { type: 'object', required: ['green'], properties: { green: { type: 'boolean' }, summary: { type: 'string' } } };
  const prClause = pr ? `${pr} ` : '';
  let ciPassed = false;
  for (let ci = 1; ci <= budget; ci++) {
    const ciOut = await agent(
      `CI check iteration ${ci}: watch CI for the PR/MR and report status. Detect the VCS host from \`git remote get-url origin\`. GitHub: run \`gh pr checks ${prClause}--watch\`. GitLab: run \`glab ci status\` or \`glab pipeline status\` (use whichever is available). Return green=true if all checks pass, green=false if any fail. Include a summary of failing checks if any.`,
      { label: `ci:${ci}`, agentType, schema: ciSchema }
    );
    if (ciOut && ciOut.green) {
      ciPassed = true;
      if (persistOnGreen === 'loop') await persistPhase(beadId, 'CIPassed', { iterations: ci });
      break;
    }
    if (ci < budget) {
      const implResult = await runPhase({
        phasePrompt: (i, fb) => `Impl re-run iteration ${i} after CI failure. ${fb ? 'Address grader feedback: ' + fb : ''} CI output: ${JSON.stringify(ciOut)}. Fix failing checks. Prior impl: ${JSON.stringify(getImplResult().out)}`,
        phaseSchema: SCHEMAS.implementation,
        agentType: 'scope-locked-editor',
        label: `impl:ci-fix:${ci}`,
        maxIterations: 1,
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
