// src/workflows/eval-tool.src.js
// @@USE: schemas,bd-memory,args,model-tiers,env-check,handoff,operating-posture
export const meta = {
  name: 'eval-tool',
  description: 'Evaluate external tools/repos for the zk stack — adopt/inspire/reject. Intake -> assess -> verdict -> append to EVALS.md catalog -> lift-route (emit /improve or /feature command at a seam; never auto-merge or auto-chain).',
  phases: [{title:'Intake'},{title:'Assess'},{title:'Verdict'},{title:'Catalog'},{title:'LiftRoute'}],
};
// @@FRAGMENTS@@

const a = readArgs(args);

// Guard: ZK_ARTIFACTS_DIR required — EVALS.md catalog lives there.
const _zkCheck = requireZkArtifacts();
if (_zkCheck.missing) {
  await agent(handoffPrompt(_zkCheck.message, 'Set ZK_ARTIFACTS_DIR in shell profile, source it, then retry.'), { label: 'handoff:missing-env', agentType: 'researcher', model: MODEL_TIERS.fast });
  return { verdict: 'needs_human', phase: 'env-check' };
}

// Guard: bd must be initialized (run memory).
const _bdPreflight = await agent(BD_PREFLIGHT_PROMPT, { label: 'preflight:bd', agentType: 'researcher', model: MODEL_TIERS.fast });
if (!_bdPreflight || _bdPreflight.ok === false) {
  const _bdReason = (_bdPreflight && _bdPreflight.reason) || 'bd not initialized — run: cd ~/dev/zk-flow && bd init';
  await agent(handoffPrompt(_bdReason, 'Run: cd ~/dev/zk-flow && bd init, then retry.'), { label: 'handoff:bd-missing', agentType: 'researcher', model: MODEL_TIERS.fast });
  return { verdict: 'needs_human', phase: 'bd-preflight' };
}

const repos = (a._ || []).filter(s => /^https?:\/\//.test(s) || /\//.test(s));
if (repos.length === 0) {
  await agent(handoffPrompt('no repo URL provided', 'Run: /eval-tool <repo-url> [<repo-url> ...]'), { label: 'handoff:no-input', agentType: 'researcher', model: MODEL_TIERS.fast });
  return { verdict: 'needs_human', phase: 'intake' };
}

const evalBeadId = 'zk-flow-eval'; // bd requires the db prefix
const EVALS_PATH = '$ZK_ARTIFACTS_DIR/skills/general/tools/tooling-eval/EVALS.md';

async function persistEval(type, payload) {
  await agent(`Persist run memory. Run EXACTLY this shell, then report done:\n\`\`\`\n${bdWrite(evalBeadId, type, payload)}\n\`\`\``, { label: `persist:${type.toLowerCase()}`, agentType: 'researcher', model: MODEL_TIERS.fast });
}

const results = [];

for (const repo of repos) {
  // --- INTAKE (read-only) ---
  phase('Intake');
  const intake = await agent(
    `${postureFor('research', a)}\n\nIntake the repo ${repo} for evaluation (READ-ONLY; do not clone-and-run). Capture: exact SPDX license (use 'gh api repos/<owner>/<repo>/license' -> .license.spdx_id, or the LICENSE file), one-line purpose, entry points, README headline claims. Cite URLs. Return a compact JSON object {repo, license, purpose, entry_points, claims, evidence}.`,
    { label: `intake:${repo}`, agentType: 'researcher', model: modelFor('research', a) }
  );

  // --- ASSESS + VERDICT (apply tooling-eval rubric) ---
  phase('Assess');
  phase('Verdict');
  const evaluation = await agent(
    `${postureFor('research', a)}\n\nApply the tooling-eval rubric (load $ZK_ARTIFACTS_DIR/skills/general/tools/tooling-eval/SKILL.md). Rubric order, first hard-fail short-circuits the ADOPT path: (1) license gate — copyleft/BUSL/PolyForm/NOASSERTION/custom-restrictive forbids ADOPT, INSPIRE still allowed; (2) overlap vs codebase-memory-mcp/Octocode/Repomix/context-mode/bd/zk-flow/superpowers/GoalBuddy; (3) liftable patterns (named, each with a target file in our stack); (4) integration fit (dependency/latency/prompt-bloat cost; artifact-flow + memory-model impact incl. whether bd stays the right memory); (5) verdict + revisit_if. A tool already in use records verdict ADOPT + lifecycle 'ADOPTED <today>'. Intake evidence: ${JSON.stringify(intake)}. Emit a ToolEval object.`,
    { schema: SCHEMAS.eval, label: `assess:${repo}`, agentType: 'researcher', model: modelFor('research', a) }
  );
  await persistEval('ToolEval', evaluation);

  // --- CATALOG (idempotent upsert by repo into EVALS.md, external zk-artifacts repo) ---
  phase('Catalog');
  await agent(
    `Upsert this evaluation into the catalog at ${EVALS_PATH} (one '## owner/repo — VERDICT (date)' section per tool, idempotent BY REPO — replace the existing section for this repo if present, else append before EOF). Use today's date via the shell: $(date +%F). Follow the entry template in the tooling-eval SKILL.md exactly (repo, license, verdict, lifecycle, overlaps, liftable_patterns, integration_analysis, revisit_if). Do NOT touch any other section. Evaluation: ${JSON.stringify(evaluation)}.`,
    { label: `catalog:${repo}`, agentType: 'scope-locked-editor', model: modelFor('persist', a) }
  );

  // --- LIFT-ROUTE (STOP at seam: emit command, never auto-chain/merge) ---
  phase('LiftRoute');
  const patterns = Array.isArray(evaluation.liftable_patterns) ? evaluation.liftable_patterns : [];
  let lift = null;
  if ((evaluation.verdict === 'ADOPT' || evaluation.verdict === 'INSPIRE') && patterns.length > 0) {
    // Heuristic: code/new-workflow lift -> /feature; skill/prompt-text lift -> /improve.
    const looksLikeCode = patterns.some(p => /workflow|src\/|\.js|agent|schema|fragment|new file/i.test(p));
    const cmd = looksLikeCode
      ? `/feature lift patterns from ${evaluation.repo} into zk-flow: ${patterns.join('; ')}`
      : `/improve lift patterns from ${evaluation.repo}: ${patterns.join('; ')}`;
    lift = {
      repo: evaluation.repo,
      verdict: evaluation.verdict,
      command: cmd,
      patterns,
    };
    await agent(
      handoffPrompt(
        `Eval verdict ${evaluation.verdict} for ${evaluation.repo} with liftable patterns. Lift NOT auto-applied (seam).`,
        `Run when ready: ${cmd}`
      ),
      { label: `liftroute:${repo}`, agentType: 'researcher', model: MODEL_TIERS.fast }
    );
  }

  results.push({ repo: evaluation.repo, verdict: evaluation.verdict, lifecycle: evaluation.lifecycle || 'n/a', lift });
}

await persistEval('EvalBatch', { count: results.length, results });

return {
  verdict: 'evaluated',
  evaluated: results.length,
  results,
};
