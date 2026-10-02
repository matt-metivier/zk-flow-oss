// src/fragments/pause-operator.js
// First-class human-in-the-loop pause seams. A pause returns a terminal object;
// the operator resumes by rerunning the workflow with startAt=<phase> bead=<id>.

export function parsePauseBefore(value) {
  if (Array.isArray(value)) return value.map(String).map(s => s.trim()).filter(Boolean);
  if (!value || value === true) return [];
  return String(value).split(',').map(s => s.trim()).filter(Boolean);
}

export function shouldPauseBefore(phaseName, pauseBefore) {
  if (!phaseName) return false;
  const phase = String(phaseName).toLowerCase();
  return parsePauseBefore(pauseBefore).some(p => p.toLowerCase() === phase);
}

export async function pauseForOperator({
  agent,
  handoffPrompt,
  phaseName,
  beadId,
  resumeCommand,
  reason = `pauseBefore=${phaseName}`,
  payload = {},
  model,
  agentType = 'pr-author',
  label,
}) {
  const message = `Operator approval required before ${phaseName}. Reason: ${reason}. bead=${beadId}.`;
  if (agent && handoffPrompt) {
    await agent(handoffPrompt(message, resumeCommand), {
      agentType,
      label: label || `handoff:pause-operator:${phaseName}`,
      ...(model ? { model } : {}),
    });
  }
  return {
    verdict: 'waiting_for_operator',
    phase: phaseName,
    bead: beadId,
    reason,
    next: `run ${resumeCommand}`,
    ...payload,
  };
}
