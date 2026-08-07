Run the update workflow: `.claude/workflows/update.js`

Arguments: $ARGUMENTS

Session-end knowledge sync: crawl Telegram/Slack/Jira for live operational state, diff against bd memories + vault <org> notes + machine persona, and write deltas (capped bd remember + operator-gated vault refresh + persona-drift flag). Never overwrites vault notes or persona files autonomously.

**Phases:** Gather (parallel Telegram/Slack/Jira) -> Diff (vs bd memories + vault + persona) -> Write (bd remember, surface stale notes, persona-drift flag)

**Args:**
| Arg | Meaning | Default |
|---|---|---|
| `model=<tier\|id>` | Model override for all phases | Per-phase defaults |

**Example:**
```
/update
/update model=research
```

**Outputs:**
- `verdict: 'update_complete'` — memories written, stale vault notes surfaced, persona drift flag set
- `verdict: 'update_skipped'` — all sources unavailable (Telegram + Slack + Jira all failed)
- `verdict: 'needs_human'` — env or bd not initialized

**Source:** `src/workflows/update.src.js`
