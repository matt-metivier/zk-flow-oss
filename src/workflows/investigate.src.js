// src/workflows/investigate.src.js
// @@USE: run-phase,handoff,budgets,schemas,args,bead-run,model-tiers,env-check,guardrails,prompt-loader,bd-memory,operating-posture,skill-render,context-pack
export const meta = {
  name: 'investigate',
  description: 'Production incident investigation: gather observability signals -> map topology -> past incident lookup -> form hypotheses -> propose mitigations. Never executes mitigations — always hands off to human.',
  phases: [{title:'Signal'},{title:'Propose'}],   // Signal covers gather+hypothesise (one runPhase, SRE gather-then-reason)
};
// @@FRAGMENTS@@

const a = readArgs(args);
const beadId = runBeadId(a);

// Guard: ZK_ARTIFACTS_DIR required for observability.md + vault/Solutions lookup
const _zkCheck = requireZkArtifacts();
if (_zkCheck.missing) {
  await agent(handoffPrompt(_zkCheck.message, 'Set ZK_ARTIFACTS_DIR in shell profile, source it, then retry.'), { label: 'handoff:missing-env', agentType: 'researcher', model: MODEL_TIERS.fast });
  return { verdict: 'needs_human', phase: 'env-check' };
}

// Guard: bd preflight
const _bdPreflight = await agent(BD_PREFLIGHT_PROMPT, { label: 'preflight:bd', agentType: 'researcher', model: MODEL_TIERS.fast });
if (!_bdPreflight || _bdPreflight.ok === false) {
  const _bdReason = (_bdPreflight && _bdPreflight.reason) || 'bd not initialized — run: cd ~/dev/zk-flow && bd init';
  await agent(handoffPrompt(_bdReason, 'Run: cd ~/dev/zk-flow && bd init, then retry.'), { label: 'handoff:bd-missing', agentType: 'researcher', model: MODEL_TIERS.fast });
  return { verdict: 'needs_human', phase: 'bd-preflight' };
}

const incident = a.brief || (a._ ? a._.join(' ') : '(describe incident)');
const timeWindow = a.window || a.time || 'now-1h';
const service = a.service || a.svc || '(infer from incident description)';

// Ops skills for the incident (alerting/monitoring/logging/repo runbooks). /investigate
// had no discover phase, so the investigator ran without them.
const skillsBlock = await selectAndRenderSkills(
  incident + ' ' + service,
  { time_window: timeWindow, service_hint: service },
  modelFor('discover', a)
);

// Durable context: machine persona + prior beads + vault MOC. This workflow has no
// discover phase, so none of the three reached its agents before.
const ctxBlock = await contextPack(incident + ' ' + service, service, modelFor('discover', a));

// --- SIGNAL + HYPOTHESIS (combined — Google SRE pattern: gather then reason) ---
phase('Signal');
const investigation = await runPhase({
  phasePrompt: (i, fb) => loadPhasePrompt('investigate', {
    skills: skillsBlock,
    context: ctxBlock,
    iteration: i,
    feedback: fb || null,
    request: incident,
    research: { time_window: timeWindow, service_hint: service }
  }),
  phaseSchema: SCHEMAS.investigate,
  model: modelFor('research', a),
  gradeModel: modelFor('grade', a),
  posture: postureFor('research', a),
  agentType: 'researcher',
  label: 'investigate',
  maxIterations: PHASE_BUDGETS.research,
  beadId: beadId,
  gradePrompt: (out) => `Grade this investigation output: signals gathered (non-empty?), hypotheses ranked with evidence, every mitigation has requires_human:true, evidence_quality not weak. Output: ${JSON.stringify(out)}`,
});

if (!investigation.ok) {
  await agent(handoffPrompt(
    `Investigation did not reach hypothesis quality within budget. Incident: ${incident}`,
    'Retry /investigate with more specific brief= or service= args, or investigate manually using Grafana MCP.'
  ), { agentType: 'pr-author', label: 'handoff:investigate', model: modelFor('persist', a) });
  return { verdict: 'needs_human', phase: 'investigate' };
}

await persistPhase(beadId, 'Investigation', investigation.out);

// --- PROPOSE (handoff with structured proposals) ---
phase('Propose');
const topHypothesis = investigation.out.hypotheses?.[0];
const proposals = investigation.out.mitigation_proposals || [];

await agent(handoffPrompt(
  `Investigation complete. Service: ${investigation.out.affected_service || service}.\n` +
  `Top hypothesis (${topHypothesis?.confidence || 'unknown'} confidence): ${topHypothesis?.hypothesis || 'see bead'}\n` +
  `Mitigation proposals (${proposals.length}): ${proposals.map(p => `[${p.risk_level}${p.reversible ? '' : '/irreversible'}] ${p.proposal}`).join(' | ')}\n` +
  `Evidence quality: ${investigation.out.evidence_quality}. All proposals require human approval.`,
  `/investigate bead=${beadId} to resume, or manually execute approved mitigations then /debug for root-cause fix.`
), { agentType: 'pr-author', label: 'handoff:proposals', model: modelFor('persist', a) });

return { verdict: 'needs_human', phase: 'propose', bead: beadId };
