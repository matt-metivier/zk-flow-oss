---
name: onboard-5-claude-code-defaults
description: Claude Code hygiene layer — context-mode plugin, codebase-memory-mcp/Repomix/Octocode MCP servers, global ~/.claude/CLAUDE.md, hooks, and .claudeignore template. Run after Phase 4, before Phase 6 (daily-digest). Every tool here is commercial-use OK (MIT or Elastic 2.0). Do not substitute PolyForm-Noncommercial tools.
---

# Phase 5 — Claude Code defaults

Install the token and context hygiene layer every Claude Code session on this
machine inherits: the context-mode plugin, three MCP code-intelligence servers
(codebase-memory-mcp, Repomix, Octocode), GoalBuddy (long-mission driver),
CodeBurn (token cost observability), Caveman (output-token compression),
Understand-Anything (visual codebase onboarding), steering hooks, a terse
global `~/.claude/CLAUDE.md`, and a `.claudeignore` template.

**License posture:** every tool below is work-legal for a single engineer at a
for-profit employer. Rejected substitutes are listed at the bottom with the
reason.

---

## Step 1 — Install context-mode plugin

context-mode sandboxes tool output (98% reduction on Playwright snapshots,
access logs, long GitHub issue lists) and preserves session state across
auto-compact. License: Elastic 2.0 (commercial use OK; only blocks reselling
as a hosted service or stripping license notices).

Requires Claude Code `v1.0.33+`. Check:

```bash
claude --version
```

Update first if older:

```bash
brew upgrade claude-code                       # macOS / Linux w/ brew
npm update -g @anthropic-ai/claude-code        # npm install
```

Open Claude Code and run:

```
/plugin marketplace add mksglu/context-mode
/plugin install context-mode@context-mode
```

Restart Claude Code (or `/reload-plugins`), then verify:

```
/context-mode:ctx-doctor
```

Every check must report `[x]`. If any report `[!]`, follow the doctor output —
usually a missing Python/Node runtime or FTS5-disabled sqlite.

**Turn auto-update ON.** Claude Code ships third-party marketplaces with
auto-update OFF by default: `/plugin` → Marketplaces tab → select
`context-mode` → enable auto-update. One-time.

---

## Step 2 — Install code-intelligence MCP servers

Three complementary servers with no overlap:

| Server | Purpose | Install |
|--------|---------|---------|
| **codebase-memory-mcp** (`codebase-memory-mcp`) | Symbol graph — callers, blast radius, semantic + Cypher | `scripts/setup.sh` (single static binary; replaced CodeGraphContext 2026-06-19) |
| **Repomix** | Pack a directory into AI-optimized XML (~70% token reduction) | via `npx` — no install needed |
| **Octocode** | LSP go-to-definition / find-references + GitHub search | via `npx` — no install needed |
| **context7** | Live library/framework docs — fetch + cite version before asserting behavior | via `npx` — no install needed |

### 2a — Install codebase-memory-mcp (global)

Single static binary, zero runtime deps (no uv/Python/FalkorDB). Install binary-only
(`--skip-config` skips the installer's own hook/agent wiring — we wire manually):

```bash
curl -fsSL https://raw.githubusercontent.com/DeusData/codebase-memory-mcp/main/scripts/setup.sh | bash -s -- --skip-config
# or build from source: git clone … && scripts/build.sh  → build/c/codebase-memory-mcp -> ~/.local/bin/
```

Verify:

```bash
codebase-memory-mcp --version
```

### 2b — Index each work repo (initial + nightly refresh)

**Initial index** — run once per machine via `/onboard` (idempotent, scans all sibling git
repos automatically) or manually:

```bash
# one-shot: index all sibling repos (safe to re-run; cbm skips unchanged files)
ZK_PARENT=$(dirname "${ZK_FLOW_DIR:-$HOME/dev/zk-flow}")
for d in "$ZK_PARENT"/*/; do
  [ -d "${d}.git" ] && npx -y codebase-memory-mcp cli index_repository "{\"repo_path\":\"${d%/}\"}" &
done
wait
npx -y codebase-memory-mcp cli list_projects   # verify
```

**Nightly refresh** — `scripts/daily-rollup.sh` re-indexes every sibling repo automatically
after writing the DailyDigest bead (background, fire-and-forget). No manual step needed
after the initial index.

cbm stores its graph in SQLite under `~/.cache` — nothing is committed to the repo.

**context-mode knowledge base** — index zk-flow docs + zk-artifacts skills once per machine
so `ctx_search` can answer tool/workflow questions without re-reading files:

```
/context-mode:ctx-index  ${ZK_FLOW_DIR}/docs
/context-mode:ctx-index  ${ZK_ARTIFACTS_DIR}/skills/system
/context-mode:ctx-index  ${ZK_ARTIFACTS_DIR}/vault/Map of Contents
```

Re-run after major doc updates. `/remember` uses `ctx_search` automatically on each run.

### 2c — Wire cbm globally + per-repo servers in `.mcp.json`

cbm is wired ONCE globally in `~/.claude.json` (portable bare command — NO absolute
path, so it works on every machine):

```json
{ "mcpServers": { "codebase-memory-mcp": { "command": "codebase-memory-mcp" } } }
```

Per-repo `.mcp.json` carries only the npx servers (cbm auto-detects the repo, so it
is NOT added per-repo):

```json
{
  "mcpServers": {
    "repomix":  { "type": "stdio", "command": "npx", "args": ["repomix", "--mcp"] },
    "octocode": { "type": "stdio", "command": "npx", "args": ["-y", "octocode-mcp"] },
    "context7": { "type": "stdio", "command": "npx", "args": ["-y", "@upstash/context7-mcp"] }
  }
}
```

Commit per-repo `.mcp.json`. After restart, `/mcp` should list `codebase-memory-mcp`
(global) + repomix/octocode/context7 (per-repo) connected.

### 2d — MCP tool quick reference

| Intent | Tool to call |
|--------|-------------|
| "What calls this function?" | `mcp__codebase-memory-mcp__trace_path` — callers, blast radius |
| "Explain this module / directory" | `mcp__repomix__*` — pack and summarize |
| "Where is this symbol defined?" | `mcp__octocode__*` — LSP go-to-definition |
| "Find references across the repo" | `mcp__octocode__*` — LSP find-references |
| "Show examples of this pattern on GitHub" | `mcp__octocode__*` — GitHub search |

### 2e — Todoist MCP (user-level, personal productivity)

Unlike the code-intel servers (per-repo `.mcp.json`), the Todoist MCP is a
**user-level** server in `~/.claude.json` so it loads in every session. The
`/health` check fails until it is wired.

Get an API token from Todoist → Settings → Integrations → Developer → "API
token", then add to `~/.claude.json` (token inlined, like other user MCP tokens):

```json
"mcpServers": {
  "todoist": {
    "command": "npx",
    "args": ["-y", "@doist/todoist-mcp"],
    "env": { "TODOIST_API_KEY": "<your-todoist-api-token>" }
  }
}
```

Use the official `@doist/todoist-mcp`. Restart Claude Code; `/mcp` should list
`todoist` (51 tools — tasks, projects, sections, comments, reminders, labels).

### 2f — Statusline (ccstatusline)

[`ccstatusline`](https://github.com/sirmalloc/ccstatusline) (eval ADOPT) renders a
configurable Claude Code statusline. Install globally (faster than `npx` per render):

```bash
npm i -g ccstatusline
```

Wire it as the statusline in `~/.claude/settings.json` (takes the single `statusLine` slot):

```json
"statusLine": { "type": "command", "command": "ccstatusline" }
```

Drop the curated zk default at `~/.config/ccstatusline/settings.json` —
**model | context-length | context% | git-branch | git-changes | thinking-effort | session-cost**:

```json
{
  "version": 3,
  "lines": [[
    { "id": "1", "type": "model", "color": "cyan" },
    { "id": "2", "type": "separator" },
    { "id": "3", "type": "context-length", "color": "brightBlack" },
    { "id": "4", "type": "separator" },
    { "id": "5", "type": "context-percentage", "color": "brightBlack" },
    { "id": "6", "type": "separator" },
    { "id": "7", "type": "git-branch", "color": "magenta" },
    { "id": "8", "type": "separator" },
    { "id": "9", "type": "git-changes", "color": "green" },
    { "id": "10", "type": "separator" },
    { "id": "11", "type": "thinking-effort", "color": "yellow" },
    { "id": "12", "type": "separator" },
    { "id": "13", "type": "session-cost", "color": "blue" }
  ], [], []],
  "flexMode": "full-minus-40", "compactThreshold": 60, "colorLevel": 2,
  "gitCacheTtlSeconds": 5
}
```

To customize widgets later, run `ccstatusline` in a real terminal (interactive TUI;
rewrites the config). Valid widget types: `model`, `context-length`,
`context-percentage`, `git-branch`, `git-changes`, `thinking-effort`,
`session-cost`, `cwd`, `block-timer`, `output-style`, `version`, `terminal-width`,
`custom-text`, `custom-command`, `separator`.

---

## Step 3 — Install steering hooks

Hooks nudge Claude toward the MCP servers before it falls back to raw
Read/Grep/Glob. No reindex hook — cbm's background watcher keeps the graph fresh.

> **MCP hook contract (must hold for the prompt-suggested tools to work):**
>
> | Stage | Hook | Job |
> |---|---|---|
> | **PreToolUse:Read\|Grep\|Glob** | prompt | Redirect source-code reads to Octocode (LSP) / codebase-memory-mcp (graph) BEFORE falling back to Read/Grep. |
> | ~~**PreToolUse:Read** (folder shape)~~ | ~~prompt~~ | ~~Redirect "explain this dir" reads to Repomix.~~ **REMOVED** — breaks single-file reads in CC ≥ 2.1.163. Repomix steering lives in CLAUDE.md only. |
> | **PreToolUse:Bash** | command | `rtk hook claude` — token-reduces every shell call. |
> | ~~**PostToolUse:Edit\|Write / git commit**~~ | ~~command~~ | ~~cgc reindex~~ **REMOVED in cbm migration** — cbm auto-syncs in the background; no reindex hook needed. |
>
> If any of these are missing in `.claude/settings.json`, the MCP tools
> become aspirational — agents read the global CLAUDE.md prescription but
> the harness has no way to enforce or refresh state. Verify with
> `jq '.hooks | keys' .claude/settings.json` per repo and
> `jq '.hooks | keys' ~/.claude/settings.json` globally.

### 3a — Project-level hooks (per repo)

Add to each repo's `.claude/settings.json` (create if missing). This is the
canonical pattern — copy it verbatim. No code-intel reindex hook is needed: cbm
runs a background auto-sync watcher, so the graph stays fresh without any
PostToolUse `index` hook (this is a key cbm win over CGC, which needed the
`cgc-debounce.sh` + `cgc index`-on-commit hooks).

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Read|Grep|Glob",
        "hooks": [
          {
            "type": "prompt",
            "prompt": "If the file being read or searched is source code (not markdown, yaml, json config, or lockfile), prefer MCP tools over raw file access:\n- For single-symbol lookups (definition, references, callers): use Octocode LSP tools (go-to-definition, find-references).\n- For dependency/usage questions: use codebase-memory-mcp graph queries (trace_path / search_graph / query_graph).\n- For multi-file pattern searches or regex: allow Grep to proceed.\n- If MCP tools cannot answer or the file is non-code: allow Read/Grep/Glob to proceed normally."
          }
        ]
      }
    ]
  }
}
```

> **No reindex hook (cbm auto-sync).** cbm's watcher polls git and reindexes
> changed files in the background, so there is nothing to wire on Edit/Write or
> commit. (The old CGC setup needed a double-forked `cgc-debounce.sh` + a
> `cgc index`-on-commit hook; both are removed in the cbm migration.)

### 3b — Global RTK hook (once per machine)

RTK filters verbose shell output before it reaches Claude's context. It is
wired into the global `~/.claude/settings.json` PreToolUse:Bash hook by
`rtk init --global --agent claude`. Current rtk (`>= 0.23`) installs a thin
delegating script `~/.claude/hooks/rtk-rewrite.sh` (rtk-hook-version 3) that
calls `rtk rewrite`; older versions inlined a `rtk hook claude` command.
Verify either form is present:

```bash
grep -E "rtk-rewrite\.sh|rtk hook claude" ~/.claude/settings.json
```

If missing:

```bash
rtk init --global --agent claude
```

After init, create RTK config for max savings:
```bash
mkdir -p ~/Library/Application\ Support/rtk
cat > ~/Library/Application\ Support/rtk/config.toml << EOF
[tracking]
enabled = true
history_days = 90

[display]
emoji = false  # save output tokens
max_width = 80

[filters]
ignore_dirs = [".git","node_modules","target","__pycache__",".venv","vendor",".beads",".claude/workflows"]
ignore_files = ["*.lock","*.min.js","*.min.css","*.jsonl","*.log"]

[tee]
enabled = true
EOF
```

### 3c — Full hook event reference + skill injection via hooks

**All events + current wiring (global + per-project):**

| Event | Fires when | Global (settings.json) | zk-flow (.claude/settings.json) |
|---|---|---|---|
| `PreToolUse:Bash` | Before any Bash call | RTK rewrite (`rtk-rewrite.sh`) | inherits |
| `PreToolUse:Read\|Grep\|Glob` | Before file reads/searches | MCP-first prompt (Octocode/cbm) | same |
| `PreToolUse:WebFetch` | Before web fetch | ctx_fetch_and_index routing prompt | inherits |
| `PreToolUse:Agent` | Before subagent spawn | ctx_execute reminder for subagent output | inherits |
| `PostToolUse:mcp__*` | After large MCP call | soft ctx_execute reminder (says "continue") | same |
| `SessionStart` | Session opens | caveman-activate → caveman-ultra → context-mode cache-heal → bd prime → load-machine-context.sh | bd prime |
| `UserPromptSubmit` | Before each user message | caveman-mode-tracker | same |
| `PreCompact` | Before context compact | — | bd prime |
| `Stop` | Claude finishes responding | `rtk gain` + `daily-accumulate.sh` | inherits |
| `SubagentStop` | Subagent finishes | — (available, not wired) | — |

> **PostToolUse:Bash prompt hook — DO NOT wire.** A prompt hook on Bash PostToolUse fires after every command and can interrupt agent continuation by telling Claude "you should have used ctx_execute." Wire context-mode routing in PreToolUse instead (redirect before the call, not after).
**Max token-saving hook additions** (add to global settings.json):

```json
"PostToolUse": [
  {
    "matcher": "Bash",
    "hooks": [{"type": "prompt", "prompt": "Bash output >20 lines or >500 chars: pipe through ctx_execute or ctx_batch_execute immediately. Never dump raw bash into conversation. git log, test output, build output, dependency trees: always ctx_execute."}]
  }
],
"PreToolUse": [
  {
    "matcher": "Agent",
    "hooks": [{"type": "prompt", "prompt": "Spawning subagent. Ensure subagent uses ctx_execute/ctx_batch_execute for large output."}]
  }
]
```

**RTK: 83%+ savings at 0.9% command coverage.** Auto-rewrites via PreToolUse:Bash command hook. No manual prefix needed.

**Context-mode: 1.0.162.** Handles output sandboxing. RTK + context-mode are complementary: RTK filters at shell level, context-mode keeps filtered output out of context window.

**Caveman ultra: ~75% output token reduction.** `ultra` level (not `full`) = max compression while preserving all technical accuracy.


**Key skill injection mechanism — `load-machine-context.sh`:**

`~/.claude/hooks/load-machine-context.sh` fires on every SessionStart and injects:
- Top 40 lines of `$ZK_ARTIFACTS_DIR/skills/agent/machines/$ALIAS/persona.md`
- Full `$ZK_ARTIFACTS_DIR/skills/agent/machines/$ALIAS/observability.md`

This is the primary mechanism for auto-loading machine-specific skills without the user having to invoke them manually. Add `$ALIAS/` subdirs in `skills/agent/machines/` to extend.

**Hook script location:** `~/.claude/hooks/`
- `context-mode-cache-heal.mjs` — context-mode plugin health
- `load-machine-context.sh` — persona + observability auto-inject

**Add a new skill injection hook (pattern):**
```json
{
  "SessionStart": [
    { "matcher": "", "hooks": [{ "type": "command", "command": "cat $ZK_ARTIFACTS_DIR/skills/<path>/SKILL.md" }] }
  ]
}
```
Output of the command becomes session context. Use sparingly — every line adds input tokens.



All Claude Code hook events and their zk-flow/n-machine wiring:

| Event | When it fires | Wired (global) | Wired (zk-flow) | Use for |
|---|---|---|---|---|
| `PreToolUse` | Before any tool call | RTK rewrite (Bash), MCP-first prompt (Read/Grep), Repomix prompt (Read) | Same + stricter MCP routing | Tool steering, token reduction |
| `PostToolUse` | After any tool call | (cbm auto-syncs in background; no reindex hook) | npm test after Edit/Write | auto-verify |
| `SessionStart` | Session opens | context-mode cache heal | bd prime | Plugin health, bd context load |
| `PreCompact` | Before context compaction | bd prime | bd prime | Preserve bd context across compact |
| `Stop` | Claude finishes responding | `rtk gain` (token savings summary) | — | Cost visibility per response |
| `SubagentStop` | Subagent finishes | — | — | Available, not wired yet |

**Current versions (2026-06-18):**
- context-mode: `1.0.162` (auto-updates)
- RTK: `0.42.2`
- codebase-memory-mcp: single static binary (no Python/uv/FalkorDB)
- Caveman: `655b7d9c5431` (latest)
- bd: `1.0.4`
- context7: `@upstash/context7-mcp` (via npx)

**cbm indexed repos:** <service>-backend, dev, docker-base-image, <org>, <service>-backend, haas-ci-base, infra-salt, <org>, <org>, <org>, the-auth-app, the-inventory-backend, zk-artifacts, zk-flow

Index a new repo: `codebase-memory-mcp cli index_repository (cbm auto-syncs after)`
Re-index after bulk changes: `codebase-memory-mcp cli index_repository` (from repo root)


---

### 3d — Worktrees, path-scoped rules, and CLAUDE.md hygiene

**Worktree isolation for writer agents** — any agent that edits files should declare `isolation: worktree` in frontmatter. Each invocation gets its own git branch + working dir so parallel sessions don't conflict:

```yaml
# In .claude/agents/scope-locked-editor.md
---
name: scope-locked-editor
isolation: worktree
---
```

Start your own session in a worktree: `claude --worktree` or `-w`. Desktop app does this automatically for every session.

**Copy gitignored files into worktrees** — create `.worktreeinclude` at repo root:
```
.env
.env.local
.beads/
```

**Path-scoped rules** (`.claude/rules/`) — load only when Claude reads matching files. Better than bloating CLAUDE.md:

| Approach | File | Loads when | Use for |
|---|---|---|---|
| Per-directory CLAUDE.md | Inside the dir | Reading any file from that dir | Directory-owned conventions |
| Path-scoped rules | `.claude/rules/*.md` with `path:` frontmatter | Reading files matching `path:` glob | Cross-cutting rules by file type |

Example `.claude/rules/fragments.md`:
```markdown
---
path: src/fragments/**/*.js
---
No import statements. Use export functions. Build.js strips exports before inlining.
```

**Stop hook → CLAUDE.md auto-update proposals** — wire in global settings.json:
```json
{
  "Stop": [{
    "matcher": "",
    "hooks": [{"type": "prompt", "prompt": "Session ending. If a gap in CLAUDE.md was revealed, propose the exact line to add and where."}]
  }]
}
```

The Stop hook fires after every response and receives the session transcript path. Use it to capture conventions while the gap is fresh.

**WorktreeCreate / WorktreeRemove hooks** — for non-git repos (SVN, Perforce) or custom setup:
```json
{ "hooks": { "WorktreeCreate": [{"hooks": [{"type": "command", "command": "..."}]}] } }
```


---

## Step 4 — Drop the global `~/.claude/CLAUDE.md`

`~/.claude/CLAUDE.md` is read by every Claude Code session on this machine, in
addition to any project-level `CLAUDE.md`. It enforces terse output,
tool-first navigation, and honest failure modes.

Copy the template from this folder:

```bash
mkdir -p ~/.claude
cp <artifacts>/skills/agent/onboard/claude-global.md.template \
   ~/.claude/CLAUDE.md
```

Replace `<artifacts>` with your absolute path to the `zk-city-artifacts`
checkout (typically `~/dev/zk-city-artifacts`).

**If you already have a `~/.claude/CLAUDE.md`, do not overwrite.** Merge the
template's rules into your existing file. The template is intentionally short
because every line adds input tokens on every turn.

The template references the RTK context via `@RTK.md` at the top — keep that
line first.

---

## Step 5 — Drop `.claudeignore` in each work repo

`.claudeignore` tells Claude Code to skip files it would otherwise auto-load
(build artifacts, vendored deps, lockfiles, generated code). Same syntax as
`.gitignore`.

For each work repo on this machine:

```bash
cd /path/to/repo
cp <artifacts>/skills/agent/onboard/claudeignore.template .claudeignore
```

Review and edit per-repo (e.g. a Go repo doesn't need the `node_modules/`
line), then commit.

---

## Step 6 — Verify

- [ ] `claude --version` reports `v1.0.33+`
- [ ] `/context-mode:ctx-doctor` all checks `[x]`
- [ ] context-mode auto-update is **ON** (`/plugin` → Marketplaces)
- [ ] `codebase-memory-mcp --version` works; `codebase-memory-mcp cli list_projects` shows all work repos indexed
- [ ] Every repo in `persona.md` has codebase-memory-mcp global in ~/.claude.json + `.mcp.json` with `repomix`, `octocode`
- [ ] In Claude Code, `/mcp` lists all three servers as connected inside a work repo
- [ ] Every repo in `persona.md` has `.claude/settings.json` with the steering hooks
- [ ] RTK Bash hook wired: `~/.claude/hooks/rtk-rewrite.sh` exists and is referenced in `~/.claude/settings.json` PreToolUse:Bash (delegates to `rtk rewrite`). Older installs used an inline `rtk hook claude` string — either form is fine.
- [ ] `~/.claude/CLAUDE.md` exists with codebase-memory-mcp tool preferences (no graphify)
- [ ] Every work repo has a `.claudeignore` at root
- [ ] `~/.claude/skills/goalbuddy/SKILL.md` exists; `~/.claude/agents/goal-{judge,scout,worker}.md` all present; verify: `rtk proxy npx -y goalbuddy doctor --target claude --goal-ready`
- [ ] `codeburn --help` works (TUI dashboard available for session-cost review)
- [ ] Caveman plugin installed: `ls ~/.claude/plugins/marketplaces/caveman/plugins` lists skill dirs; `/caveman` activates compressed output
- [ ] Caveman set to `ultra`: `cat ~/.claude/.caveman-active` → `ultra`; SessionStart hook writes `ultra` AFTER `caveman-activate.js` (which resets to `full`)
- [ ] `statusLine` wired in `~/.claude/settings.json`: `jq '.statusLine' ~/.claude/settings.json` → non-null; restart required to show badge
- [ ] context7 MCP wired: `jq '.mcpServers.context7' ~/.claude.json` non-null AND in `$ZK_FLOW_DIR/.mcp.json`
- [ ] gitnexus NOT in `~/.claude.json` project mcpServers (EVALS: REJECT — restrictive license)
- [ ] PreToolUse:WebFetch prompt hook wired (routes to ctx_fetch_and_index for docs/API pages)
- [ ] PreToolUse:Agent prompt hook wired (reminds subagents to use ctx_execute for large output)
- [ ] PostToolUse:Bash prompt hook **NOT** wired — fires on every Bash call, stops agent continuation; use PreToolUse routing instead

**Hook safety rule:** PostToolUse prompt hooks that say "you should have done X" cause Claude to stop and report rather than continue. Only wire PostToolUse prompt hooks with "continue with current output" language.

---

## Step 7 -- Install GoalBuddy (long-mission /goal driver)

GoalBuddy adds a `/goal-prep` skill plus `goal-scout`, `goal-judge`,
`goal-worker` subagents that drive multi-step missions to completion with a
local board (`docs/goals/<slug>/`), receipts, and verification gates.
Complements zk-city's converge phases for work too large for a single run.

```bash
rtk proxy npx -y goalbuddy
```

`rtk proxy` is required because the rtk PreToolUse hook otherwise rewrites
bare `npx` into a form GoalBuddy's installer rejects. Restart Claude Code
after install, then run `/goal-prep` to scaffold a board. Verify:

```bash
rtk proxy npx -y goalbuddy doctor --target claude --goal-ready
```

Should report `skill_installed: true` and three installed agents
(`goal-judge.md`, `goal-scout.md`, `goal-worker.md`) with no missing/stale.

The installer also tries the Codex target; on fleet machines without
`codex` CLI the Codex side fails (`spawnSync codex ENOENT`) and is safely
ignored.

---

## Step 8 — Install CodeBurn (token cost observability)

CodeBurn is a TUI dashboard surfacing where Claude Code (and Codex / Cursor)
tokens go. Useful for spotting runaway sessions, comparing per-repo cost,
and validating the savings from context-mode + RTK + the MCP routing hooks.

```bash
npm install -g codeburn
# or run ad-hoc:
npx -y codeburn
```

> **Package name:** the published npm package is the unscoped `codeburn`
> (maintainer `agentseal`, MIT). The scoped `@getagentseal/codeburn` does
> **not** exist on npm (404) — do not use it.

Verify:

```bash
codeburn --help
```

Run `codeburn` interactively to view a live dashboard of recent Claude Code
sessions, token spend, and per-tool breakdown. License: MIT.

Optional companion: `kai-kou/codeburn-daily-report` posts daily summaries to
Slack DM — install only if a daily-spend cadence is wanted.

---

## Step 9 — Install Caveman (token-compressed comms mode)

Caveman is a Claude Code plugin (skills + a SessionStart hook) that
ultra-compresses the agent's *output prose* — drops articles, filler, and
pleasantries while preserving all technical substance, code, and quoted
errors verbatim. Roughly 75% fewer output tokens on conversational turns.
Complements the input-side hygiene (context-mode, RTK, MCP routing) by
trimming the output side. License: MIT (`JuliusBrussee/caveman`).

It also ships companion skills: `/caveman-commit` (Conventional Commits,
≤50-char subject), `/caveman-review` (one-line PR comments), and
`/caveman:compress` (compress CLAUDE.md / memory files in place).

Install via the plugin marketplace:

```
/plugin marketplace add JuliusBrussee/caveman
/plugin install caveman@caveman
```

Restart Claude Code (or `/reload-plugins`). Default level set to `ultra` via:
```bash
echo -n "ultra" > ~/.claude/.caveman-active
```
Add to SessionStart hook in settings.json:
```json
{"type": "command", "command": "echo -n ultra > ~/.claude/.caveman-active 2>/dev/null || true"}
```
Levels: `lite` / `full` / `ultra`. Turn off with
`stop caveman` or `normal mode`. Verify the plugin is registered:

```bash
ls ~/.claude/plugins/marketplaces/caveman/plugins
```

> **Output-only.** Caveman compresses prose. Code, commits, PRs, security
> warnings, and irreversible-action confirmations are always written
> normally — the skill's auto-clarity rules enforce this.

---

## Step 10 — Install Understand-Anything (visual codebase onboarding)

Understand-Anything (`Lum1104/Understand-Anything`, MIT) runs a multi-agent pass
over a repo to build a knowledge graph of files/functions/deps, then serves an
interactive dashboard + guided tours + an onboarding-guide generator. It fills a
gap the code-intelligence trio does **not** cover: a *visual map + human onboarding
tour* for getting oriented in an unfamiliar repo. Keep Repomix for packed-text
overviews and codebase-memory-mcp for precise symbol navigation; reach for
Understand-Anything when a human (or you) needs the big-picture visual map.

```
/plugin install understand-anything
```

Commands: `/understand` (build the graph), `/understand-dashboard`,
`/understand-onboard` (guided tour), `/understand-diff` (diff impact),
`/understand-explain`, `/understand-domain` (business-logic view).

> **Cost note.** The build pass is a multi-agent run that spends tokens. Position
> it as the **human-onboarding / visual** tool, not the everyday code-nav tool —
> for routine "what calls X / where is Y" use codebase-memory-mcp + Octocode (cheaper, faster).
> Optional post-commit auto-update can be enabled for incremental re-analysis.

---

## License summary

| Tool | License | Commercial use |
|------|---------|----------------|
| context-mode (`mksglu/context-mode`) | Elastic 2.0 | OK — blocks only SaaS reselling |
| codebase-memory-mcp (DeusData/codebase-memory-mcp, MIT) | MIT | OK |
| Repomix | MIT | OK |
| Octocode MCP | MIT | OK |
| RTK (`rtk-ai/rtk`) | MIT | OK |
| `claude-global.md.template` rules | MIT | OK |
| GoalBuddy (`tolibear/goalbuddy`) | MIT | OK |
| CodeBurn (`codeburn` on npm, maintainer `agentseal`) | MIT | OK |
| Caveman (`JuliusBrussee/caveman`) | MIT | OK |
| Understand-Anything (`Lum1104/Understand-Anything`) | MIT | OK |

**Tool evaluations** (adopt / inspire / reject) now live in their own catalog — see
[`skills/general/tools/tooling-eval/EVALS.md`](../../general/tools/tooling-eval/EVALS.md),
maintained by the `tooling-eval` skill and the `/eval-tool` workflow. The eval-batch
tables that used to live here were migrated there 2026-06-16 (and the duplicate
`chopratejas/headroom` row resolved to a single INSPIRE entry).

---


### Step 11 — Agent Teams (experimental)

Agent Teams coordinate multiple Claude Code sessions working together. One session is the team lead; teammates have fully independent context windows and can message each other directly.

**Already enabled** in your global settings:
```json
{ "env": { "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1" } }
```

**Comparison with parallel subagents:**

| | Subagents (`parallel()`) | Agent Teams |
|---|---|---|
| Context | Own window, results back to caller | Own window, fully independent |
| Token cost | Lower (results summarized) | Higher (each = separate instance) |
| Communication | Report to main agent only | Teammates message each other |
| Stability | Stable | Experimental — known limitations |
| Best for | Focused parallel tasks | Complex work needing peer collaboration |

**Use Agent Teams when:** multiple agents need to discuss findings, challenge each other, and coordinate without going through a coordinator. Example: "architect + implementer + reviewer iterating together on a design."

**Use subagents when:** parallel focused tasks that just return results. **This is the right choice for: review council perspectives, grill challenges, research fanout.** Our zk-flow workflows use subagents correctly — Agent Teams would cost more for these patterns.

**Hooks for Agent Teams** (in settings.json):
```json
"TeammateIdle": [{ "matcher": "", "hooks": [{"type": "command", "command": "echo done"}] }]
```
New hook events: `TeammateIdle`, `TaskCreated`, `TaskCompleted`.

Requires Claude Code v2.1.32+. Check: `claude --version`.


---


### Step 12 — zk-flow workflow router hook

Auto-suggests the right `/workflow` based on what you type. Fires on every `UserPromptSubmit` — zero latency, non-blocking.

**Create the hook script:**
```bash
mkdir -p ~/.claude/hooks
curl -o ~/.claude/hooks/zk-flow-router.sh \
  https://raw.githubusercontent.com/matt-metivier/zk-flow/main/docs/zk-flow-router.sh 2>/dev/null || \
cat > ~/.claude/hooks/zk-flow-router.sh << 'ROUTER'
#!/usr/bin/env bash
set -euo pipefail
INPUT=$(cat)
MSG=$(echo "$INPUT" | python3 -c "
import json,sys
d=json.load(sys.stdin)
msg=d.get('message',d.get('prompt',''))
if isinstance(msg,list): msg=' '.join(b.get('text','') for b in msg if isinstance(b,dict))
print(msg.lower())
" 2>/dev/null || echo "")
[ -z "$MSG" ] && exit 0
SUGGESTION=""
echo "$MSG" | grep -qE '\b(implement|add feature|build feature|new feature|create feature|add support for|develop)\b' && SUGGESTION="/feature"
echo "$MSG" | grep -qE '\b(fix bug|fix the bug|broken|not working|failing test|regression)\b' && SUGGESTION="/bugfix"
echo "$MSG" | grep -qE '\b(debug|root cause|why is|diagnose|trace|symptom|reproduce)\b' && SUGGESTION="/debug"
echo "$MSG" | grep -qE '\b(review|code review|pr review|mr review|review the (pr|mr|diff|code|change))\b' && SUGGESTION="/review"
echo "$MSG" | grep -qE '\b(investigate|incident|outage|alert firing|prod.*down|latency spike|memory leak)\b' && SUGGESTION="/investigate"
echo "$MSG" | grep -qE '\b(design|architect|plan (the|a) (feature|system|api)|sqca|design doc)\b' && SUGGESTION="/design"
echo "$MSG" | grep -qE '\b(research|spike|look into|explore)\b' && ! echo "$MSG" | grep -qE '\b(incident|outage|prod)\b' && SUGGESTION="/research"
echo "$MSG" | grep -qE '\b(refactor|restructure|clean up the code|rename.*symbol)\b' && SUGGESTION="/refactor"
echo "$MSG" | grep -qE '\b(write tests|add tests|test coverage|test strategy)\b' && SUGGESTION="/test"
echo "$MSG" | grep -qE '\b(critique|stress.?test (the )?design|adversarial review)\b' && SUGGESTION="/critique"
[ -z "$SUGGESTION" ] && exit 0
echo "[ZK-FLOW] Suggested: $SUGGESTION — run \`$SUGGESTION brief=\"<task>\"\` for full lifecycle. Or continue here."
ROUTER
chmod +x ~/.claude/hooks/zk-flow-router.sh
```

**Wire into global settings.json:**
```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "matcher": "",
        "hooks": [{"type": "command", "command": "/Users/<you>/.claude/hooks/zk-flow-router.sh"}]
      }
    ]
  }
}
```

**Pattern → workflow map:**

| Keyword | Workflow |
|---|---|
| implement / add feature / develop | `/feature` |
| fix bug / broken / regression | `/bugfix` |
| debug / root cause / diagnose | `/debug` |
| review / code review / PR review | `/review` |
| investigate / incident / prod down | `/investigate` |
| design / architect / SQCA | `/design` |
| research / spike / explore | `/research` |
| refactor / restructure | `/refactor` |
| write tests / test coverage | `/test` |
| critique / stress-test design | `/critique` |
| general question | *(silent)* |

Non-blocking — always gives option to continue without workflow.


---

## Updating

- **context-mode**: `/context-mode:ctx-upgrade` inside any Claude Code session.
  Auto-update handles this if Step 1 was followed.
- **codebase-memory-mcp**: `codebase-memory-mcp update`.
- **Repomix / Octocode**: updated automatically by `npx` on each use.
- **RTK**: `cargo install --git https://github.com/rtk-ai/rtk` to update.
- **GoalBuddy**: `rtk proxy npx -y goalbuddy update` (updates Claude Code skill + agents).
- **CodeBurn**: `npm update -g codeburn` (or rerun via npx).
- **Caveman**: auto-updates with the plugin marketplace; force with
  `/plugin marketplace update caveman`.
- **`~/.claude/CLAUDE.md` and repo `.claudeignore`**: pull `zk-city-artifacts`
  and re-copy the templates.

---

## Result

After this phase, every Claude Code session on this machine:

- Sandboxes large tool output through context-mode
- Steers code navigation to codebase-memory-mcp (callers/callees), Repomix
  (directory overview), and Octocode (symbol definition / GitHub search)
  before falling back to raw Read/Grep
- Re-indexes codebase-memory-mcp automatically after every `git commit`
- Opens with terse output rules already in place
- Skips build artifacts, lockfiles, and generated code on auto-load

The per-session overhead added by `~/.claude/CLAUDE.md` is under 400 input
tokens. The savings compound on every Glob, every Read, every MCP call.
