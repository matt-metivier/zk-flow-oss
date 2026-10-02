Run the investigate workflow: `.claude/workflows/investigate.js`

Arguments: $ARGUMENTS

Production incident investigation: gather observability signals (Grafana/Loki/Prometheus) → map service topology → look up past incidents → form ranked hypotheses → propose mitigations. Always hands off to human — never executes mitigations.

**Phases:** Signal+Hypotheses → Propose (handoff)

**Args:**
| Arg | Meaning | Default |
|---|---|---|
| `brief=<text>` | Incident description. Preferred. | Positional `_` text |
| `service=<name>` | Affected service name (hint) | Inferred from brief |
| `window=<duration>` | Observability lookback window | `now-1h` |
| `bead=<id>` | Correlation bead id | Derived from brief slug |
| `model=<tier>` | Model override | Per-phase defaults |

**Example:**
```
/investigate brief="<org> health check failures on rack 14" service=<org> window=now-2h
/investigate "PDU input current spike dc=vin3"
```

**Observability routing** is per-machine via `$ZK_ARTIFACTS_DIR/skills/agent/machines/<alias>/observability.md`.
For machine `n`: grafana-infra (<org>/PDU/vmalert), grafana (RDHx/SNMP), grafana-vin (BMS).

**Output:** Handoff doc in `$TMPDIR` with ranked hypotheses + mitigation proposals. Resume with `/debug` after approving a mitigation.
