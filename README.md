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
| **`bd` (beads CLI)** | Optional. Structured run memory + improve signal. [github.com/steveyegge/beads](https://github.com/steveyegge/beads). Agents degrade gracefully if `bd` is absent |
| **`zk-artifacts` repo** | Optional. A private companion repo holding your skills, vault, and personas -- see [Setting up zk-artifacts](#setting-up-zk-artifacts) |

---

## Quick start

```bash
git clone https://github.com/matt-metivier/zk-flow.git
cd zk-flow
npm install          # runs prepare -> build.js -> generates .claude/workflows/*.js
```

Open Claude Code in the `zk-flow` directory, then run a workflow:

```
/feature "add rate limiting to the API"
/review depth=standard
/bugfix "login fails when email has uppercase letters"
/research "evaluate tradeoffs between Postgres and DynamoDB for this use case"
```

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

## Workflow catalog

| Workflow | What it runs | Doc |
|---|---|---|
| `feature` | Full lifecycle: discover -> research -> design -> *(approve)* -> impl -> ci -> review -> testing. `skipReview=true` bypasses review council; `startAt=impl bead=<id>` resumes after human design approval | [docs/workflows/feature.md](docs/workflows/feature.md) |
| `bugfix` | discover -> research -> impl -> ci -> testing (no design or review council) | [docs/workflows/bugfix.md](docs/workflows/bugfix.md) |
| `refactor` | discover -> research -> refactor -> test (restructures code WITHOUT behavior change; CGC blast-radius before every symbol edit) | [docs/workflows/refactor.md](docs/workflows/refactor.md) |
| `debug` | reproduce+root-cause -> fix -> test (diagnoses symptom to ROOT CAUSE with file:line proof, then fixes it; tighter than bugfix) | [docs/workflows/debug.md](docs/workflows/debug.md) |
| `design` | discover -> research -> design panel -> handoff | [docs/workflows/design.md](docs/workflows/design.md) |
| `research` | discover -> research -> handoff (spike/investigate; stops before design) | [docs/workflows/research.md](docs/workflows/research.md) |
| `test` | Standalone test strategy: test-research -> test-design -> test-run, by `targetEnv` | [docs/workflows/test.md](docs/workflows/test.md) |
| `review` | Depth-gated multi-perspective review (none/light/standard/full) -> arbiter synthesis | [docs/workflows/review.md](docs/workflows/review.md) |
| `critique` | designer -> (devils-advocate or grill) -> response -> 6-perspective council -> grade | [docs/workflows/critique.md](docs/workflows/critique.md) |
| `grill` | Adversarial griller -> decider (interview or one-shot modes) | [docs/workflows/grill.md](docs/workflows/grill.md) |
| `improve` | Cluster bead feedback -> propose -> verify -> grade -> stage (never auto-merges) | [docs/workflows/improve.md](docs/workflows/improve.md) |
| `finish-pr` | Resume an open PR: verify -> load context -> impl-fix -> ci -> review -> testing (`pr=<url>`) | [docs/workflows/finish-pr.md](docs/workflows/finish-pr.md) |
| `dashboard` | Fetch monitoring config JSON -> apply change -> verify; optional sibling delete (`api=` `id=` `brief=`) | [docs/workflows/dashboard.md](docs/workflows/dashboard.md) |

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
