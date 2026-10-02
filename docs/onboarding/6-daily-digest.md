---
name: onboard-6-daily-digest
description: Daily cross-machine handoff layer — wire the zk-flow daily-digest Stop-hook accumulator + launchd rollup so each machine captures the day's work into a host-scoped bead, and /remember loads yesterday across all machines the next day. Run after Phase 5 as the last onboarding step. All-local tooling (zk-flow scripts + bd); no external services.
---

# Phase 6 — Daily-digest handoff

Wire the end-of-day handoff so work on this machine is captured into a bead
and picked up the next day on any machine. Three pieces, all shipped in
`zk-flow` (`scripts/daily-accumulate.sh`, `scripts/daily-rollup.sh`,
`src/workflows/remember.src.js`). Capture is deterministic and tokenless; the
only LLM step is `/remember` narration.

## Prerequisites

- Phases 1–5 complete (`ZK_FLOW_DIR`/`ZK_ARTIFACTS_DIR` set, `bd` initialized,
  zk-flow checked out, `~/.claude/settings.json` present).
- `bd` syncs over the git remote (`refs/dolt/data`) — daily-digest beads ride
  that same sync; no extra `bd dolt` config.

## Step 1 — Pull the latest zk-flow

```bash
cd "${ZK_FLOW_DIR:-$HOME/dev/zk-flow}" && git pull --ff-only
```

The scripts ship with the executable bit set; the project Stop hook is in
`zk-flow/.claude/settings.json`.

## Step 2 — Install the rollup timer (once per machine)

```bash
cd "${ZK_FLOW_DIR:-$HOME/dev/zk-flow}" && scripts/daily-rollup.sh --install
```

Writes and loads `~/Library/LaunchAgents/com.zk-flow.daily-rollup.plist`
(`StartInterval` 3600 = hourly tick; `ZKFLOW_DAILY_DIR` / `ZK_FLOW_DIR` /
`ZKFLOW_IDLE_HOURS` baked in, since launchd does not inherit the shell env).
Verify:

```bash
launchctl list | grep com.zk-flow.daily-rollup
```

## Step 3 — Capture ALL sessions (user-level Stop hook)

The project hook only fires for sessions rooted inside `zk-flow`. To capture
every session on the machine (any repo), add the accumulator as a second
`Stop` entry in `~/.claude/settings.json` (alongside any existing Stop hook):

```json
{
  "matcher": "",
  "hooks": [
    { "type": "command", "command": "\"${ZK_FLOW_DIR:-$HOME/dev/zk-flow}/scripts/daily-accumulate.sh\" 2>/dev/null || true" }
  ]
}
```

The accumulator is tokenless, never blocks the turn, and exits 0 on any input.

## Step 4 — Verify

```bash
# accumulator writes a host-scoped scratch line
echo '{"cwd":"/x","last_assistant_message":"onboard check"}' \
  | "${ZK_FLOW_DIR:-$HOME/dev/zk-flow}/scripts/daily-accumulate.sh"
ls ~/.local/share/zk-flow/daily/    # expect <host>-<YYYYMMDD>.jsonl + <host>.last-activity
```

## How it runs

- Each turn → accumulator appends `{cwd, prompt, bead, ts}` to
  `~/.local/share/zk-flow/daily/<host>-<YYYYMMDD>.jsonl`.
- Hourly tick → rollup fires only when **idle ≥ 2h** (`ZKFLOW_IDLE_HOURS`),
  **dirty**, and **not already rolled today**; it writes a deterministic
  `DailyDigest` to bead `zk-flow-daily-<host>-<YYYYMMDD>` (label `daily-digest`)
  and the bead syncs via the existing git-hook bead sync.
- Next day, on any machine → `/remember` pulls, reads every host's digest for the
  target day, merges per-host, and narrates where each machine left off.

`host = hostname -s` (lowercased) keeps bead ids per-machine so 4 machines
never write-conflict. The vault is NOT used (it does not sync reliably across
machines); bd/dolt git-native sync is the aggregation layer.
