Run the dashboard workflow: `.claude/workflows/dashboard.js`

Arguments: $ARGUMENTS

Monitoring dashboard config update: fetch the current JSON from a monitoring REST API, apply a requested change, POST it back, and verify by re-GETting. Optionally delete a sibling dashboard after. Generic across monitoring tools; Grafana is the concrete reference implementation.

**Phases:** Fetch -> Edit+Apply -> Verify

**Args:**
| Arg | Meaning | Default / behavior |
|---|---|---|
| `api=<url>` | Base URL of the monitoring API (e.g. `https://grafana.example.com`). **Required.** | If missing, workflow writes a handoff and returns `needs_human`. |
| `id=<uid>` | Dashboard UID or resource ID to operate on. **Required.** | If missing, workflow writes a handoff and returns `needs_human`. |
| `brief=<text>` | Description of the change to make (e.g. "set panel threshold to 90"). | If absent, agent infers from context. |
| `deleteSibling=<uid>` | UID of a dashboard to delete after the main apply+verify succeeds. | Unset -- skip delete step. |
| `bead=<id>` | Correlation/run bead id. Normalized to `[a-z0-9._-]`. Pass to correlate re-runs. | Derived from `id` slug if unset. |
| `model=<tier|id>` | Global model override applied to every phase (`fast`/`mid`/`deep` or raw model id). | Unset -> per-phase defaults. |
| `models=<phase:tier,...>` | Per-phase tier overrides, e.g. `models=fetch:deep,verify:fast`. Wins over `model`. | Unset. |

**Example:** `/dashboard api=https://grafana.example.com id=abc123 brief="set alert threshold to 90%"`
