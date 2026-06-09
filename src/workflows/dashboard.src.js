// src/workflows/dashboard.src.js
// @@USE: run-phase,handoff,budgets,schemas,args,bd-memory,bead-run,model-tiers,env-check
export const meta = {
  name: 'dashboard',
  description: 'Monitoring dashboard config update: fetch JSON from API -> edit -> apply -> verify. Optional sibling delete.',
  phases: [{title:'Fetch'},{title:'Edit+Apply'},{title:'Verify'}],
};
// @@FRAGMENTS@@

const a = readArgs(args);

// Guard: bd must be initialized (run: bd init in this directory if not)
const _bdPreflight = await agent(BD_PREFLIGHT_PROMPT, { label: 'preflight:bd', agentType: 'researcher', model: MODEL_TIERS.fast });
if (!_bdPreflight || _bdPreflight.ok === false) {
  const _bdReason = (_bdPreflight && _bdPreflight.reason) || 'bd not initialized — run: cd ~/dev/zk-flow && bd init';
  await agent(handoffPrompt(_bdReason, 'Run: cd ~/dev/zk-flow && bd init, then retry.'), { label: 'handoff:bd-missing', agentType: 'researcher', model: MODEL_TIERS.fast });
  return { verdict: 'needs_human', phase: 'bd-preflight' };
}

const beadId = runBeadId(a);

// --- REQUIRE api + id ---
if (!a.api || !a.id) {
  await agent(
    handoffPrompt(
      `dashboard workflow requires api=<base_url> and id=<dashboard_uid>. Got: api=${a.api || '(missing)'}, id=${a.id || '(missing)'}`,
      '/dashboard api=<base_url> id=<uid> brief=<change>'
    ),
    { agentType: 'dashboard-editor', label: 'handoff:missing-args', model: modelFor('persist', a) }
  );
  return { verdict: 'needs_human', phase: 'args' };
}

// --- FETCH ---
phase('Fetch');
const fetchSchema = {
  type: 'object',
  required: ['fetched'],
  properties: {
    fetched: { type: 'boolean' },
    summary: { type: 'string' }
  }
};
const fetchResult = await agent(
  `Fetch the current dashboard JSON from the monitoring API.
API base URL: ${a.api}
Dashboard UID: ${a.id}
Brief (the change that will be applied next): ${a.brief || '(see prompt context)'}
GET the dashboard config using the REST API. Auth token from $GRAFANA_TOKEN (or apiToken passed in prompt).
Emit {"fetched":true,"summary":"<title, panels, relevant info>"} on success, {"fetched":false,"summary":"<error>"} on failure.`,
  { schema: fetchSchema, agentType: 'dashboard-editor', label: 'fetch:1', model: modelFor('research', a) }
);
await persistPhase(beadId, 'Fetch', fetchResult);

if (!fetchResult.fetched) {
  await agent(
    handoffPrompt(
      `dashboard Fetch failed: ${fetchResult.summary || '(no detail)'}. Check that api= and id= are correct and $GRAFANA_TOKEN is set.`,
      '/dashboard api=<base_url> id=<uid> brief=<change>'
    ),
    { agentType: 'dashboard-editor', label: 'handoff:fetch-failed', model: modelFor('persist', a) }
  );
  return { verdict: 'needs_human', phase: 'fetch' };
}

// --- EDIT + APPLY ---
phase('Edit+Apply');
const applySchema = {
  type: 'object',
  required: ['applied'],
  properties: {
    applied: { type: 'boolean' },
    summary: { type: 'string' }
  }
};
const applyResult = await agent(
  `${postureFor('impl', a)}\n\nApply the requested change to the dashboard and POST it back.
API base URL: ${a.api}
Dashboard UID: ${a.id}
Change to make: ${a.brief || '(infer from context)'}
Prior fetch summary: ${fetchResult.summary || ''}
Re-GET the dashboard, apply the change (idempotent: if already present, no-op), then POST via the API.
Auth token from $GRAFANA_TOKEN (or apiToken passed in prompt).
Emit {"applied":true,"summary":"<what changed or already-present no-op>"} or {"applied":false,"summary":"<error>"}.`,
  { schema: applySchema, agentType: 'dashboard-editor', label: 'apply:1', model: modelFor('impl', a) }
);
await persistPhase(beadId, 'EditApply', applyResult);

// --- VERIFY ---
phase('Verify');
const verifySchema = {
  type: 'object',
  required: ['verified'],
  properties: {
    verified: { type: 'boolean' },
    summary: { type: 'string' }
  }
};
const verifyResult = await agent(
  `Verify the dashboard change was applied correctly.
API base URL: ${a.api}
Dashboard UID: ${a.id}
Expected change: ${a.brief || '(infer from context)'}
Re-GET the dashboard and confirm the change is present in the live config.
Emit {"verified":true,"summary":"<confirmation>"} or {"verified":false,"summary":"<discrepancy>"}.`,
  { schema: verifySchema, agentType: 'dashboard-editor', label: 'verify:1', model: modelFor('verify', a) }
);
await persistPhase(beadId, 'Verify', verifyResult);

if (!verifyResult.verified) {
  await agent(
    handoffPrompt(
      `dashboard Verify failed: ${verifyResult.summary || '(no detail)'}. The change may not have been applied. Check API response and retry.`,
      '/dashboard api=<base_url> id=<uid> brief=<change>'
    ),
    { agentType: 'dashboard-editor', label: 'handoff:verify-failed', model: modelFor('persist', a) }
  );
  return { verdict: 'needs_human', phase: 'verify' };
}

// --- OPTIONAL: deleteSibling ---
if (a.deleteSibling) {
  const deleteSchema = {
    type: 'object',
    required: ['deleted'],
    properties: {
      deleted: { type: 'boolean' },
      uid: { type: 'string' },
      summary: { type: 'string' }
    }
  };
  const deleteResult = await agent(
    `Delete the sibling dashboard with UID ${a.deleteSibling} from the monitoring API.
API base URL: ${a.api}
DELETE /api/dashboards/uid/${a.deleteSibling} with auth token from $GRAFANA_TOKEN (or apiToken passed in prompt).
Emit {"deleted":true,"uid":"${a.deleteSibling}"} on success, {"deleted":false,"summary":"<error>"} on failure.`,
    { schema: deleteSchema, agentType: 'dashboard-editor', label: 'delete-sibling:1', model: modelFor('persist', a) }
  );
  await persistPhase(beadId, 'DeleteSibling', deleteResult);
}

return { verdict: 'APPROVE', id: a.id };
