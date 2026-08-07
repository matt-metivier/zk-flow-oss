#!/usr/bin/env bash
# run-cost.sh — total $ cost of a zk-flow workflow run, from its agent transcripts.
#
# The workflow runtime writes one agent-<id>.jsonl per subagent (with an
# agent-<id>.meta.json carrying its agentType). Each assistant message records
# message.model + message.usage {input,output,cache_creation,cache_read}. This
# sums tokens per model, applies Claude pricing, and prints total + per-model +
# per-agentType breakdowns. No deps (pure node + bash).
#
# Usage:
#   scripts/run-cost.sh <transcript-dir>     # the "Transcript dir" the Workflow launch prints
#   scripts/run-cost.sh <runId>              # e.g. wf_8fd85f37-b9c — resolved under ~/.claude/projects
#   scripts/run-cost.sh --json <dir|runId>   # machine-readable
set -euo pipefail

JSON=0; ARG=""
for a in "$@"; do case "$a" in --json) JSON=1 ;; *) ARG="$a" ;; esac; done
[ -n "$ARG" ] || { echo "usage: run-cost.sh [--json] <transcript-dir|runId>" >&2; exit 2; }

# Resolve a runId to its transcript dir.
DIR="$ARG"
if [ ! -d "$DIR" ]; then
  DIR="$(find "$HOME/.claude/projects" -type d -name "$ARG" -path '*subagents*' 2>/dev/null | head -1)"
  [ -n "$DIR" ] || DIR="$(find "$HOME/.claude/projects" -type d -name "*$ARG*" -path '*workflows*' 2>/dev/null | head -1)"
fi
[ -d "$DIR" ] || { echo "no transcript dir for '$ARG'" >&2; exit 1; }

DIR="$DIR" JSON="$JSON" node <<'NODE'
const fs = require('fs'), path = require('path');
const DIR = process.env.DIR, JSON_OUT = process.env.JSON === '1';

// $/token = $/1M / 1e6. cache_read ~0.1x input; cache write 5m 1.25x, 1h 2x.
const P = {
  'claude-opus-4-8':   { in: 5e-6,  out: 25e-6, cr: 0.5e-6,  cw5: 6.25e-6, cw1h: 10e-6 },
  'claude-sonnet-4-6': { in: 3e-6,  out: 15e-6, cr: 0.3e-6,  cw5: 3.75e-6, cw1h: 6e-6 },
  'claude-haiku-4-5':  { in: 1e-6,  out: 5e-6,  cr: 0.1e-6,  cw5: 1.25e-6, cw1h: 2e-6 },
};
const rate = (m) => P[m] || P[Object.keys(P).find(k => m && m.startsWith(k.slice(0, 13)))] || P['claude-sonnet-4-6'];

const files = fs.readdirSync(DIR).filter(f => f.endsWith('.jsonl') && f.startsWith('agent-'));
const byModel = {}, byAgent = {};
let totalCost = 0, totalTok = 0, unknownModels = new Set();

for (const f of files) {
  let agentType = 'unknown';
  try { agentType = JSON.parse(fs.readFileSync(path.join(DIR, f.replace('.jsonl', '.meta.json')), 'utf8')).agentType || 'unknown'; } catch {}
  for (const line of fs.readFileSync(path.join(DIR, f), 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let o; try { o = JSON.parse(line); } catch { continue; }
    const u = o.message && o.message.usage, model = o.message && o.message.model;
    if (!u || !model) continue;
    if (!P[model] && !Object.keys(P).some(k => model.startsWith(k.slice(0, 13)))) unknownModels.add(model);
    const r = rate(model);
    const cw5 = (u.cache_creation && u.cache_creation.ephemeral_5m_input_tokens) || 0;
    const cw1h = (u.cache_creation && u.cache_creation.ephemeral_1h_input_tokens) || 0;
    const cwFallback = cw5 + cw1h ? 0 : (u.cache_creation_input_tokens || 0);
    const cost = (u.input_tokens || 0) * r.in + (u.output_tokens || 0) * r.out
      + (u.cache_read_input_tokens || 0) * r.cr + cw5 * r.cw5 + cw1h * r.cw1h + cwFallback * r.cw5;
    const tok = (u.input_tokens || 0) + (u.output_tokens || 0) + (u.cache_read_input_tokens || 0) + cw5 + cw1h + cwFallback;
    totalCost += cost; totalTok += tok;
    byModel[model] = (byModel[model] || 0) + cost;
    byAgent[agentType] = (byAgent[agentType] || 0) + cost;
  }
}

if (JSON_OUT) {
  console.log(JSON.stringify({ total_usd: +totalCost.toFixed(4), total_tokens: totalTok, by_model: byModel, by_agent: byAgent, unknown_models: [...unknownModels] }, null, 2));
} else {
  const usd = (n) => '$' + n.toFixed(4);
  console.log(`Run cost: ${usd(totalCost)}  (${(totalTok / 1e6).toFixed(2)}M tokens across ${files.length} agents)`);
  console.log('\nby model:');
  for (const [m, c] of Object.entries(byModel).sort((a, b) => b[1] - a[1])) console.log(`  ${m.padEnd(20)} ${usd(c)}`);
  console.log('\nby agent type:');
  for (const [a, c] of Object.entries(byAgent).sort((x, y) => y[1] - x[1])) console.log(`  ${a.padEnd(20)} ${usd(c)}`);
  if (unknownModels.size) console.log(`\n! unknown models priced at sonnet rate: ${[...unknownModels].join(', ')}`);
}
NODE
