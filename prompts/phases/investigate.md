# Investigate Phase

**Context injected by workflow:** incident description, time window, affected service hint, observability.md content — passed via `loadPhasePrompt(ctx)`.

## Role

Gather observability signals → map topology → retrieve past incidents → form ranked hypotheses → propose mitigations. Read-only. Never execute mitigations — always hand to human.

## Step 1: Load observability config

Load `$ZK_ARTIFACTS_DIR/skills/agent/machines/$(bd config get host 2>/dev/null)/observability.md`.
This tells you which MCP to use for which signal type on this machine.
If file missing: use whatever Grafana MCP is available; note gap in receipt.

## Step 2: Gather signals (parallel)

Based on observability.md, gather in parallel:
- **Active alerts**: `mcp__grafana-*__list_alert_groups` — find firing alerts related to the incident
- **Metrics**: `mcp__grafana-*__query_prometheus` with relevant metric names/labels
- **Logs**: `mcp__grafana-*__query_loki_logs` — logs from affected service ±15min around incident start
- **Incidents**: `mcp__grafana-*__list_incidents` — open Grafana incidents
- **Dashboard context**: `mcp__grafana-*__get_dashboard_panel_queries` for relevant panels

Time window: use incident description to pick `now-Xh`. Default: `now-1h`.

## Step 3: Map topology

For the affected service:
- CodeGraphContext: callers, callees, deps (`mcp__codegraphcontext__analyze_code_relationships`)
- Read relevant runbook if known: `$ZK_ARTIFACTS_DIR/vault/` or service docs
- Find recent deploys: `git log --oneline -20` in the affected repo (may correlate with incident start)

## Step 4: Retrieve past incidents

- `bd list` — prior beads with similar service/error labels
- `$ZK_ARTIFACTS_DIR/vault/Solutions/` — grep for matching error strings, service names
- `$ZK_ARTIFACTS_DIR/vault/Map of Contents/` — find relevant KB file for context

## Step 5: Form hypotheses

Rank by: supporting signal count × confidence × past incident recurrence.

Each hypothesis must cite:
- Which signals support it (metric name, log pattern, or alert name)
- Confidence (high/medium/low)
- Any matching past incident from bd/vault

## Step 6: Propose mitigations

For each top-2 hypothesis, propose ONE mitigation. Every proposal must include:
- `risk_level`: low/medium/high/critical
- `reversible`: true/false
- `requires_human: true` — ALWAYS. Never propose auto-execution in zk-flow.
- `runbook_ref` if exists

## Anti-patterns

- Proposing mitigations without hypothesis ranking
- Querying wrong Grafana instance (check observability.md routing table)
- Treating symptom as root cause
- Marking evidence_quality `strong` with only one signal source
- Proposing irreversible actions without `risk_level: high` or `critical`

## Output


**Required schema fields** (`schemas/investigate.json`):
`outcome`, `affected_service`, `time_window`, `signals[]`, `hypotheses[]`, `mitigation_proposals[]`, `evidence_quality`

Emit JSON matching `schemas/investigate.json` as final message.
