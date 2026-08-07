# zk-flow

zk-flow is a local, interactive Claude Code dynamic-`/workflows` system that runs
software-engineering lifecycles -- research, design, implementation, review, and testing --
as orchestrated subagent workflows. You invoke a workflow from a Claude Code session
(`/feature "add OAuth"`, `/review depth=standard`), and zk-flow drives a pipeline
of specialized subagents through ordered phases, gate loops, and fan-out steps until the
work is done or a human decision is needed. No daemon, no external orchestrator, no cloud
service -- it runs entirely inside Claude Code.

---

## Requirements

| Requirement | Notes |
|---|---|
| **Claude Code >= v2.1.154** | Dynamic `/workflows` is a research-preview feature; update Claude Code if workflows don't appear |
| **Node.js** | Any recent LTS (18+); used only by the build step |
| **`bd` (beads CLI)** | **Required.** Workflows fail fast if not initialized. Install: [github.com/steveyegge/beads](https://github.com/steveyegge/beads) |
| **`zk-artifacts` repo** | **Required for skill selection.** Workflows fail fast if `ZK_ARTIFACTS_DIR` unset. Holds skills, vault, personas, machine-specific context. See [Setting up zk-artifacts](#setting-up-zk-artifacts) |

---

## Setup

```bash
# 1. Clone and install (npm install runs build.js -> generates .claude/workflows/*.js)
git clone https://github.com/matt-metivier/zk-flow ~/dev/zk-flow
cd ~/dev/zk-flow && npm install

# 2. Initialize bd + pin BEADS_DIR (required — workflows fail fast without it)
#    BEADS_DIR MUST be exported so bd resolves from ANY cwd. Workflows launched
#    from outside ~/dev/zk-flow (e.g. cwd ~/dev) otherwise can't reach the bead DB
#    and silently fail to persist phase artifacts (research/design) — the run
#    stalls at the design gate. /health enforces this.
bd init
echo 'export BEADS_DIR="$HOME/dev/zk-flow/.beads"' >> ~/.zshrc
#    Claude Code: also add to ~/.claude/settings.json "env" so subagents inherit it:
#      "env": { "BEADS_DIR": "/Users/<you>/dev/zk-flow/.beads" }

# 3. Set artifacts dir (required — skill/persona/vault lookup fails without it)
echo 'export ZK_ARTIFACTS_DIR="$HOME/dev/zk-artifacts"' >> ~/.zshrc
echo 'export ZK_VAULT_DIR="$ZK_ARTIFACTS_DIR/vault"' >> ~/.zshrc   # optional convenience alias
source ~/.zshrc

# 4. Symlink into Claude Code global config
ln -s ~/dev/zk-flow/.claude/commands   ~/.claude/commands
ln -s ~/dev/zk-flow/.claude/workflows  ~/.claude/workflows
cp ~/dev/zk-flow/.claude/agents/*.md   ~/.claude/agents/

# 5. Verify (inside a Claude Code session rooted in ~/dev/zk-flow)
/health
```

Then run a workflow:

```
/feature "add rate limiting to the API"
/review depth=standard
/debug "login fails when email has uppercase letters"
/research "evaluate tradeoffs between Postgres and DynamoDB for this use case"
```

> **Team / multi-machine onboarding** — personas, people skills, tribal knowledge, and the
> Claude Code hygiene layer (MCP servers, hooks, global `CLAUDE.md`) are a separate, deeper
> layer. The setup above covers a single machine; for the full human/org layer follow the
> numbered guides in [`docs/onboarding/`](docs/onboarding/) (or run `/onboard` for the
> idempotent auto-fix, then `/health`). Personal persona/vault data still lives in
> `$ZK_ARTIFACTS_DIR`.

---

## Using zk-flow in other repos

Slash commands (`/feature`, `/review`, etc.) only resolve inside the directory where `.claude/commands/` lives. After running `npm run build`, pick one of three install options:

**(a) Global install** -- commands available in every repo:

```bash
cp -r .claude/commands   ~/.claude/commands
cp -r .claude/workflows  ~/.claude/workflows
cp -r .claude/agents     ~/.claude/agents
```

Set `$ZK_ARTIFACTS_DIR` in your shell profile as before. The built `.claude/workflows/*.js` files must be present (run `npm run build` first). Tradeoff: one shared version -- all repos get the same copy until you re-copy.

**(b) Per-repo copy** -- isolated, independently upgradeable:

```bash
cp -r /path/to/zk-flow/.claude /your/repo/.claude
```

Re-copy whenever you pull updates from zk-flow. Tradeoff: multiple copies to keep in sync.

**(c) Symlink** -- single source of truth, always current:

```bash
ln -s /path/to/zk-flow/.claude /your/repo/.claude
```

Any `npm run build` in zk-flow immediately applies everywhere the symlink is used. Tradeoff: all symlinked repos move together on every update.

---

## How it works

zk-flow is organized in five layers: **workflows** (orchestration -- phase order, gate
loops, fan-out, handoff boundaries), **agents** (subagents: a prompt + model + tools),
**skills** (domain how-to loaded from `$ZK_ARTIFACTS_DIR`), **schemas** (JSON contracts
that validate each phase's output), and **memory** (beads for structured run state + vault
for prose knowledge). A workflow invokes agents, agents produce schema-validated JSON, and
the workflow decides what runs next based on the verdict. Human approval is modeled as a
handoff: the workflow writes a continuation doc and stops; you resume it explicitly.

See [docs/architecture.md](docs/architecture.md) for the full five-layer breakdown, gate
loop mechanics, the two-run `feature` seam, and schema validation contracts.
See [docs/using-schemas-externally.md](docs/using-schemas-externally.md) for how to validate
schema contracts when dispatching agents outside the /workflows runtime.

> **Generated files:** `.claude/workflows/*.js` are built from `src/workflows/*.src.js` and
> are gitignored. `npm run build` (or `npm install`) regenerates them. Never edit the
> generated files directly.

---

## Install as a plugin

The published mirror doubles as a plugin marketplace, so a second machine does not need the
manual onboard steps (agent sync, workflow symlink):

```
/plugin marketplace add matt-metivier/zk-flow-oss
/plugin install zk-flow@zk-flow-marketplace
```

The snapshot ships the BUILT workflow bundles, because a plugin is copied to the cache
as-is and nothing runs `npm install` at install time. `scripts/sync-oss.sh` aborts rather
than publish a snapshot with fewer than 13 built workflows.

Skills ship as a SECOND plugin, `zkengine`, sourced from the private companion repo — the
manifest's `skills` field takes an array of roots, so the nested tree ships without
flattening. That entry is stripped from the published catalog, so it only installs for
someone with access to that repo.

`scripts/install-skills.sh` still runs, but once the plugin is installed it symlinks ONLY
what a plugin cannot carry: skills whose directory resolves outside the repo (a plugin is
copied to a cache and does not follow symlinks out of the plugin). On this machine that is
15 of 88; the other 73 arrive as `/zkengine:<name>`. `/health` fails if any catalog skill is
reachable by neither path, or by both.

## Workflow catalog

| Workflow | What it runs | Doc |
|---|---|---|
| `feature` | Full lifecycle: discover -> research -> design -> *(approve)* -> impl -> ci -> simplify -> review -> testing. `skipReview=true` bypasses review council; `skipSimplify=true` bypasses the post-CI simplify pass; `startAt=impl bead=<id>` resumes after human design approval; `autoApprove=true` skips the human seam and chains design->impl in one run | [docs/workflows/feature.md](docs/workflows/feature.md) |
| `feature profile=small` | discover -> research -> impl -> ci -> testing (no design or review council; small low-risk additive changes — for bugs use `debug`). Replaces the former standalone `/small-feature` (removed — was an orphan generated file with no source). | [docs/workflows/feature.md](docs/workflows/feature.md) |
| `refactor` | discover -> research -> refactor -> test (restructures code WITHOUT behavior change; cbm blast-radius before every symbol edit) | [docs/workflows/refactor.md](docs/workflows/refactor.md) |
| `debug` | reproduce+root-cause -> fix -> test (diagnoses symptom to ROOT CAUSE with file:line proof, then fixes it; the bug-fix path) | [docs/workflows/debug.md](docs/workflows/debug.md) |
| `design` | discover -> research -> design panel -> handoff | [docs/workflows/design.md](docs/workflows/design.md) |
| `research` | discover -> research -> handoff (spike/investigate; stops before design) | [docs/workflows/research.md](docs/workflows/research.md) |
| `test` | Standalone test strategy: test-research -> test-design -> test-run, by `targetEnv` | [docs/workflows/test.md](docs/workflows/test.md) |
| `review` | Depth-gated multi-perspective review (none/light/standard/full) -> arbiter synthesis; perspectives incl. `simplify` at standard+full | [docs/workflows/review.md](docs/workflows/review.md) |
| `simplify` | Standalone quality-only pass: apply reuse/dead-code/altitude cleanups directly, tighten the PR description, verify via CI. `pr=<url>` targets an open PR; omit for a local-only pass | [docs/workflows/simplify.md](docs/workflows/simplify.md) |
| `critique` | designer -> (devils-advocate or grill) -> response -> 6-perspective council -> grade | [docs/workflows/critique.md](docs/workflows/critique.md) |
| `grill` | Adversarial griller -> decider (interview or one-shot modes) | [docs/workflows/grill.md](docs/workflows/grill.md) |
| `improve` | Cluster bead feedback -> propose -> verify -> grade -> stage (never auto-merges) | [docs/workflows/improve.md](docs/workflows/improve.md) |
| `finish-pr` | Resume an open PR: verify -> load context -> impl-fix -> ci -> review -> testing (`pr=<url>`) | [docs/workflows/finish-pr.md](docs/workflows/finish-pr.md) |
| `dashboard` | Fetch monitoring config JSON -> apply change -> verify; optional sibling delete (`api=` `id=` `brief=`) | [docs/workflows/dashboard.md](docs/workflows/dashboard.md) |
| `vault-sync` | Repo -> vault notes: scan what merged on the default branch since the last sync (git + cbm), diff against existing notes, **grade the plan** (vault-note rubric: evidence cited, nothing invented, no credentials), write, advance the bd marker. `repo=all dir=<path>` sweeps a workspace root (`repo=` `since=` `dryRun=true` `maxRepos=`) | [docs/workflows/vault-sync.md](docs/workflows/vault-sync.md) |
| `eval-tool` | Evaluate external tools/repos for adoption: intake -> assess -> verdict (adopt/inspire/reject) -> append to the tooling-eval EVALS.md catalog -> lift-route (emit `/improve` or `/feature` at a seam; never auto-merge) | [docs/workflows/eval-tool.md](docs/workflows/eval-tool.md) |

### Per-phase model tiers

Each phase uses an appropriate model tier by default. Override per run with `model=<tier>`
(global) or `models=<phase>:<tier>,...` (per-phase):

| Tier | Model | Used for |
|---|---|---|
| `fast` | claude-haiku | ci-watch, persist/handoff |
| `mid` | claude-sonnet | discover, research, review perspectives, testing |
| `deep` | claude-opus | design, impl, arbiter/grader synthesis |

Example: `/feature model=fast "..."` runs all phases on haiku (cheap demo mode).
Example: `/feature models=research:deep,impl:fast "..."` deep research, cheap impl.

---

## Setting up zk-artifacts

zk-flow workflows load domain skills, prose knowledge (vault), and operator personas from a
companion repo at `$ZK_ARTIFACTS_DIR`. This is completely optional -- if the variable is
unset, agents skip skill/vault lookups and run on their base prompts alone.

See [docs/zk-artifacts-setup.md](docs/zk-artifacts-setup.md) for setup steps and the skill
frontmatter template.

### How skills actually reach an agent

Two mechanisms, both keyed off the generated `skills/CATALOG.md`:

| | Where | How |
|---|---|---|
| **Workflow prompts** | inside a `/feature`, `/debug`, ... run | Workflows with a discover phase select catalog ids and `renderSkills` cats them into the downstream prompts. Workflows without one (`debug`, `test`, `investigate`, `review`, `critique`, `grill`, `simplify`, `dashboard`, `vault-sync`) call `selectAndRenderSkills` — one fast-tier call that prefilters the catalog, selects up to 5 ids, and loads them. |
| **Interactive sessions** | any `claude` session on the machine | `scripts/install-skills.sh` symlinks each catalog skill to `~/.claude/skills/zk-<name>`, so they are invocable as `/zk-<name>` and appear in the model's skill listing. Claude Code discovery is one level deep, so this flattening is required — the artifacts tree nests up to five. |

`/onboard` runs both the catalog freshness check and the install; `/health` fails when
either has drifted. `/improve`, `/update`, `/remember`, and `/eval-tool` deliberately skip
skill selection — see `tests/skill-wiring.test.js` for the reason attached to each.

---

## Dev

```bash
npm test        # unit tests for src/fragments (pure logic) + build validity guard
npm run build   # regenerate .claude/workflows/*.js from src/workflows/*.src.js
```

**Test suite:** 9 test files covering args parsing, bd-command builders, budgets, depth map,
handoff, model tiers, schemas, verdict routing, and a build validity guard that asserts every
`*.src.js` builds clean (has `export const meta`, no leftover markers, no `import` lines,
parses as valid JS).

**Layout:**

```
src/
  fragments/     pure helpers (inlined at build time: args, bd-memory, ci-loop, ...)
  workflows/     *.src.js workflow bodies (source of truth)
build.js         build script: inlines fragments, writes .claude/workflows/*.js
.claude/
  agents/        22 subagent definitions (YAML frontmatter + prompt body)
  commands/      saved slash commands (one per workflow)
  workflows/     GENERATED -- gitignored, do not edit
schemas/         JSON output contracts for each phase
docs/
  architecture.md
  workflows/     per-workflow reference docs (args, agents, schemas, mermaid diagrams)
  using-schemas-externally.md
  zk-artifacts-setup.md
```

---

## License

Apache-2.0 -- see [LICENSE](LICENSE).
