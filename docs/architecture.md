# zk-flow Architecture -- how prompts, workflows, skills, agents, schemas & memory fit together

zk-flow is a **local, interactive** harness for agent lifecycles on Claude Code
**dynamic `/workflows`**. No `gc` supervisor, no `zkc` binary, no cron. You drive it from a
Claude Code session inside this repo.

## The five layers

```
  /feature "<task>"            <- you invoke a saved WORKFLOW (slash command)
        |
   WORKFLOW (src/workflows/*.src.js -> built into .claude/workflows/*.js)
   the orchestration: phase order, gate loops, fan-out, handoff boundaries
        |  spawns subagents with agent(prompt, { agentType, schema })
        v
   AGENT (.claude/agents/<name>.md)        <- a subagent: a PROMPT + model + tools
   its prompt embeds the phase rubric + output contract
        |  reads/loads
        +--> SKILL  ($ZK_ARTIFACTS_DIR/skills/<id>/SKILL.md)   domain how-to, by path
        |  validates output against
        +--> SCHEMA (schemas/<phase>.json, inlined into the workflow)
        |  persists cross-run memory via
        +--> beads (`bd`)  +  reads prose from  vault ($ZK_ARTIFACTS_DIR/vault)
```

### 1. Workflows -- the orchestration (who decides what runs next)
- Authored in `src/workflows/*.src.js`; `build.js` inlines the `src/fragments/*` they declare
  in a `// @@USE:` manifest (replacing `// @@FRAGMENTS@@`) into self-contained
  `.claude/workflows/*.js` (the workflow sandbox has **no `import`/filesystem**, so logic is
  concatenated at build time, not imported).
- A workflow holds the phase pipeline, the bounded gate loops, the fan-out (`parallel`), and
  the boundaries. It calls agents; it does **not** do the work itself.
- Saved workflows are **slash commands** invoked interactively (`/feature ...`). Args
  arrive as a **string** -- every body does `const a = readArgs(args)` then reads `a.depth` etc.

### 2. Agents -- the workers (prompt + model + tools)
- `.claude/agents/<name>.md`: YAML frontmatter (`name`, `description`, `model`, `tools`) + a
  prompt body. 22 agents, flat (no subdirs -- flat is what `agentType` resolves).
- A workflow spawns one with `agent(prompt, { agentType: 'researcher', schema: SCHEMAS.research })`.
- **Execution contract:** an agent's FINAL message is its structured JSON output; the workflow
  captures + validates it via `schema:`. Agents do NOT write phase output to a bead, do NOT call
  `gc`/`zkc`. Feedback + selected skills arrive *in the prompt* (the workflow injects them).

### 3. Skills -- domain how-to (shared, in zk-artifacts)
- Live in `$ZK_ARTIFACTS_DIR/skills/<id>/SKILL.md` (the renamed `zk-artifacts` repo), each with
  template frontmatter (`name`, `description`, `depends_on`). Shared across machines via git.
- An agent loads a skill by **path** (`$ZK_ARTIFACTS_DIR/skills/general/practices/humanizer/SKILL.md`)
  when its prompt selects it. The `discover`/`researcher` phase picks which skills downstream
  phases should load (`discover.json: skills[]`).
- Example: the `handoff` skill (`skills/general/practices/handoff`) is loaded when a workflow
  hits a boundary / needs_human / session-exit and must write a continuation doc.

### 4. Schemas -- the contracts (gate validation)
- `schemas/*.json` (research, design, implementation, review, testing, discover, proposal,
  solution). Ported verbatim from the predecessor's design.
- Used two ways: (a) `schema:` on an `agent()` call forces the agent's output to validate
  (replaces the predecessor's validate step); (b) the gate loop reads the verdict field to
  decide satisfied / iterate / escalate.
- **Gate recovery on exhaustion**: when a phase exhausts its iteration budget AND the
  tier-escalation ladder without APPROVE, `runPhase` returns
  `{ ok:false, backtrackEligible:true }`. The `backtrack` fragment's
  `runWithBacktrack(prev, cur, {budget})` lets a workflow re-run the PRIOR phase once per
  `PHASE_BUDGETS.backtrack` (default `0` = off) before `needs_human` — for when the real
  fault is upstream (e.g. impl keeps failing because the design was wrong).
  See `docs/designs/2026-06-16-backtrack-gate-recovery.md`.
  - **Standardization policy** (which code-producing workflows wire it):
    `debug` (fix→root-cause), `small-feature` (impl→research), `refactor` (refactor→research) — all
    default-off via the shared `PHASE_BUDGETS.backtrack`. `feature` is intentionally **not**
    wired: its two-run design→human-approval→`startAt=impl` seam already serves as the design
    backtrack, and auto-re-running design would bypass that approval gate. `research`/`test`/
    `dashboard`/`review`/`critique`/`grill` produce no code, so backtrack-to-prior adds nothing.

### 5. Memory -- beads (structured) + vault (prose)
- **beads (`bd`)** = persistent, queryable run memory + the improve signal. Agents read
  prior learnings (`bd ready`/`bd show`) and write evidence (`bd comment`). Local only.
- **vault** (`$ZK_ARTIFACTS_DIR/vault`) = prose knowledge (solution writeups, notes). The
  `researcher`/`prior-art` agents consult it; `solution-extractor`/`vault-writer` add to it.

## Gates & boundaries (the lifecycle enforcement)
- Every iterating phase runs through `runPhase` (`src/fragments/run-phase.js`): it runs the
  phase agent, then a **`grader` agent** that emits a `review.json` verdict on the output, and
  loops (feeding the grader's findings back into the next iteration) until `APPROVE` or the
  budget is hit. Because the grader supplies the verdict, phases whose own schema has no
  `verdict` field (research/impl/testing) still gate on quality -- they are not free passes.
- Bounded loops (`PHASE_BUDGETS`): research 2, design 2, impl 2, ci 3, review/council 3, testing 2.
- A phase that doesn't reach `APPROVE` within budget escalates: the final agent writes a
  **handoff doc** (`handoffPrompt`) and the workflow returns `{ verdict: 'needs_human' }`.
- **Review council:** 5 parallel perspectives (`DEFAULT_PERSPECTIVES`: advocate, critic,
  security, performance, learning), then the **`arbiter`** agent is the synthesis step
  (dedups same-`file:line` findings -> highest severity, emits the `review.json` verdict).
  The `critique` workflow's council synthesis uses the `grader` instead (design verdict).
- `feature` has a **two-run seam**: run 1 = discover->research->design, then stop with a
  handoff (human approves the design); run 2 (`/feature startAt=impl bead=<id>`) =
  impl->ci->review->testing. Both runs must share the **same `bead=<id>`** so run 2 reads run 1's
  design from beads. This is how an "approval gate" works given workflows can't pause for input.
- **Schema validation contract across seams:** Phase outputs are schema-validated at production
  (`schema:` on `agent()`). Artifacts crossing the bead/process seam (two-run resume,
  cross-workflow handoff) are **re-validated against their schema on load**: run 2 issues two
  separate schema-checked `agent()` loads -- one against `SCHEMAS.design`, one against
  `SCHEMAS.research`. A load agent that cannot produce a schema-valid artifact (bead
  missing/corrupt/incomplete) escalates immediately: it writes a handoff doc (agentType
  `pr-author`) and returns `{ verdict: 'needs_human', reason: 'could not load valid
  design/research from bead' }`. Only when both loads succeed does run 2 proceed to impl.
  Cross-workflow handoffs (`design`, `research`) hand off a `bead=<id>`;
  validation of those artifacts lives on the consuming side (feature run 2), which is the
  pattern above.

### Durable context (persona, prior beads, vault MOC)

Three signals an agent cannot infer from the code in front of it: **who/what this machine
is** (`skills/agent/machines/<host>/persona.md`), **what prior runs learned** (bd beads,
especially GraderFeedback), and **what the knowledge base already covers**
(`vault/Map of Contents/`).

All three used to ride the discover phase — and 13 of 18 workflows have no discover phase.
Measured before the fix: persona reached 4 workflows, MoC reached the discover prompt only,
and `bdBoundedContext` (the bounded cross-run retrieval helper) was called from nowhere
outside `bd-memory.js` itself. `/investigate`, the workflow that most needs machine facts,
had none of them.

Two paths now, mirroring how skills reach agents:

| Path | Workflows | Mechanism |
|---|---|---|
| discover phase | feature, design, research, refactor | `buildPersonaSection()` + the discover prompt's MOC step + bounded bead retrieval |
| `contextPack()` | debug, test, investigate, review, critique, grill, simplify, dashboard, finish-pr | one fast-tier call returning persona + beads + MOC, injected via `ctx.context` or string concat |

Deliberately excluded: `update` (resolves its own persona), `remember` (digest beads *are*
the context), `vault-sync` (Scope already resolves host + marker), `improve` (operates on
the skills themselves), `eval-tool` (third-party repos — machine facts are irrelevant).

**Budgets are enforced, not suggested.** `CONTEXT_BUDGETS` caps persona at 1200 chars,
beads at 900, MOC at 700; `clampSection` truncates on a word boundary and marks the cut so
a downstream agent knows the section is partial. This block is injected into every phase
prompt of a wired workflow, so the cost is per agent call, not per run — the same reason
`operating-posture` carries a hard 1800-char budget.

Prior beads are framed at the injection point as *precedent to check, not fact*: a prior
run can have been wrong, and this system's own history includes graders that BLOCKed for
environmental reasons rather than real defects.

## Per-phase model tiers
`src/fragments/model-tiers.js` provides a tiered model-selection scheme (fast/mid/deep) for zk-flow. Every
`agent()` and `runPhase()` call in every workflow receives an explicit `model:` argument
resolved by `modelFor(phase, a)`.

**Tiers (`MODEL_TIERS`):**
| Tier | Model id | Use |
|------|----------|-----|
| `fast` | `claude-haiku-4-5-20251001` | ci-watch, persist/handoff, simple echoes |
| `mid` | `claude-sonnet-4-6` | discover, research, review perspectives, testing |
| `deep` | `claude-opus-4-8` | design, synthesis (arbiter/grader) |

**Default tier per phase (`PHASE_TIER`):**
| Phase | Tier | Rationale |
|-------|------|-----------|
| `discover` | mid | Orientation research |
| `research` | mid | Investigative depth, not design-level |
| `design` | deep | High-stakes architecture decisions |
| `impl` | mid | Code generation at sonnet tier; grader still deep |
| `review` | mid | Perspective fan-out; arbiter does the synthesis |
| `grade` | deep | Arbiter/grader synthesis = verdict authority |
| `testing` | mid | Test execution and evidence capture |
| `ci` | fast | CI check watch (defined; wired in runPhase callers, not runCI) |
| `persist` | fast | Handoff docs, GraderFeedback persist agents |
| `verify` | fast | PR existence check, bead load agents |
| `grill` | mid | Adversarial griller + devils-advocate |

**Arg overrides (resolved at runtime from `readArgs`):**
- `model=<tier|raw-id>` -- global: apply one tier (or raw model id) to every phase call.
  Example: `/feature model=fast ...` -- run all phases on haiku (CI/demo cost mode).
- `models=<phase>:<tier>[,<phase>:<tier>...]` -- per-phase: override specific phases.
  Example: `/feature models=research:deep,impl:fast` -- deep research, cheap impl.
- Per-phase wins over global when both are set.
- Raw model ids pass through unchanged: `model=claude-foo` -> `'claude-foo'` (for testing
  unreleased model strings without changing tier constants).

`runPhase` threads `model` (phase agent) and `gradeModel` (grader agent) separately, so
you can run a cheap phase agent with a deep grader or vice versa via `models=`.

Note: `runCI` (ci-loop.js) is NOT model-threaded; its agents receive no explicit `model:`
and fall back to agent frontmatter defaults. The `ci` tier is defined for symmetry and
available for future `runCI` extension.

### Operating posture layer
`postureFor(phase, a)` returns TWO things, stacked:

1. **The operating block (a FLOOR)** — `operatingInstructions()` from
   `src/fragments/operating-posture.js`. A terse, always-on conduct block woven
   into EVERY agent prompt via this single seam. Four labeled groups:
   VERIFY-BEFORE-CLAIM, SCOPE & SAFETY, JUDGMENT, COMMUNICATION. It exists
   because spawned sub-agents run sandboxed and do NOT inherit the operator's
   `~/.claude/CLAUDE.md`; the block re-injects only the residue they lack (content
   is audited against CLAUDE.md and the posture directives to avoid duplication).
   The floor is unconditional — present even for `balanced`/unknown phases.
2. **The per-phase posture DIRECTIVE** — `POSTURE: exploration|precision`, keyed
   by `PHASE_POSTURE` with `posture=`/`postures=` overrides. This stays
   separately suppressible: `posture=balanced` (or `postures=<phase>:balanced`)
   zeroes the directive but NOT the floor. The join is conditional, so a
   suppressed directive leaves no trailing whitespace: `directive ? block + "\n\n"
   + directive : block`.

**Build-time wiring.** `model-tiers.js` does `import { operatingInstructions }
from './operating-posture.js'` so it is loadable as a real ESM module by tests.
Bundles must be import-free, so `build.js` runs `stripFragmentImports` (alongside
`stripExports`) to remove that single-named relative import; `operatingInstructions`
then resolves from shared bundle scope at runtime. Every workflow's `// @@USE:`
list includes `operating-posture`, and `operatingInstructions` is in
`assertBundleSelfContained`'s `known[]` so any bundle that calls it without the
defining fragment fails the build. See `.claude/rules/fragments.md` for the
single supported import shape.

## The workflow catalog
| Workflow | Orchestrates |
|---|---|
| `feature` | full lifecycle: discover -> research -> design -> (approve) -> impl -> ci -> review -> testing; pass `skipReview=true` to bypass the review council |
| `small-feature` | discover -> research -> impl -> ci -> testing (no design/review; small low-risk additive changes — for bugs use `debug`) |
| `refactor` | discover -> research -> refactor -> test (restructures code WITHOUT behavior change; cbm blast-radius before every symbol edit) |
| `debug` | reproduce+root-cause -> fix -> test (diagnoses symptom to ROOT CAUSE with file:line proof, then fixes it; the bug-fix path) |
| `design` | discover -> research -> design panel -> handoff |
| `research` | discover -> research -> handoff (investigate/spike; stops before design) |
| `test` | test-research -> test-design -> test-run, by `targetEnv` (designs + runs a test strategy, standalone) |
| `review` | depth-gated multi-perspective review (none/light/standard/full) -> arbiter synthesis, incl. a `simplify` perspective (reuse/dead-code/altitude findings) at standard+full depth |
| `simplify` | standalone quality-only pass: apply reuse/dead-code/altitude cleanups directly to the diff, tighten the PR description (no AI-vocab, no restating the diff), verify via CI. `pr=<url>` targets an open PR (pushes + edits description); omit for a local-only pass |
| `critique` | designer -> (devils-advocate || grill) -> response -> 6-perspective council -> grade |
| `grill` | adversarial griller -> decider (interview / one-shot modes) |
| `improve` | (manual) cluster beads feedback -> propose -> verify -> grade -> stage (never auto-merge) |
| `finish-pr` | verify PR -> load context -> impl-fix -> ci -> review -> testing (resume an open PR via pr=<url>) |
| `dashboard` | fetch monitoring dashboard config JSON -> apply change -> verify; optional sibling delete (ops pattern, no code change) |
| `vault-sync` | scope repo -> scan merged history + cbm graph -> diff vs existing vault notes -> grade the plan (vault-note rubric) -> write notes + advance a per-repo bd sync marker (the only workflow that writes vault notes; target repo stays read-only) |
| `eval-tool` | intake -> assess -> verdict -> append to tooling-eval EVALS.md catalog -> lift-route (emit /improve or /feature command at a seam; never auto-merge/auto-chain). Evaluates external tools/repos adopt/inspire/reject |
| `investigate` | production incident: gather observability signals -> map topology -> past incident lookup -> hypotheses -> propose mitigations. Never auto-executes. |
| `remember` | daily handoff loader: pull + read yesterday's DailyDigest beads across all hosts -> merge per-host -> narrate where each machine left off. Pairs with the Stop-hook accumulator + launchd rollup (deterministic, cross-machine via bd sync) |
| `update` | session-end knowledge sync: crawl Telegram/Slack/Jira for live state -> diff against bd memories + vault <org> notes + machine persona -> write deltas (capped `bd remember` + operator-gated vault refresh + persona-drift flag). Read-mostly; never overwrites vault or persona files. |


---

## Workflow Comparison: review vs design vs critique vs grill

These four workflows look similar but serve distinct purposes:

| Workflow | Input | Works on | Multi-perspective? | Output |
|---|---|---|---|---|
| `/review` | current git diff | **Code** — what changed in the repo | YES — 6 perspective agents in parallel | Code quality verdict + findings |
| `/design` | task description | **Proposed work** — discover + research + design | YES — grill + 6-perspective council on the design doc | Design document → human approval seam → impl |
| `/critique` | existing design/brief | **Design artifact** — a doc or spec you already have | YES — 6-perspective council | Design quality verdict, no impl |
| `/grill` | design or PR | **Anything** — focused adversarial interview | NO — one griller + one decider | Adversarial verdict from single reviewer |

Key distinctions:
- `/review` is about **code correctness and quality** — always needs a diff
- `/design` is the **full feature lifecycle's first half** — produces implementation-ready design
- `/critique` is a **standalone design review** — useful when you have a design but no task to implement
- `/grill` is the **sharpest, cheapest adversarial pass** — one agent stress-tests one artifact

---

## Phase → Agent → Schema → Rubric Map

Every phase that runs through `runPhase()` uses a grader. The grader reads the rubric at runtime.

| Phase | Agent(s) | Schema validated | Rubric read by grader |
|---|---|---|---|
| Discover | researcher | schemas/discover.json | *(none — no grader)* |
| Research | researcher | schemas/research.json | prompts/rubrics/research-rubric.md |
| Design | designer + devils-advocate + griller | schemas/design.json | prompts/rubrics/design-rubric.md |
| Impl | scope-locked-editor | *(none explicit)* | prompts/rubrics/implementation-rubric.md |
| CI | evidence-scanner | *(none)* | *(none)* |
| Review perspectives | advocate + critic + security + performance + persona + repo-conventions + learning | schemas/review.json (arbiter output) | prompts/rubrics/review-rubric.md |
| Testing | test-runner | schemas/testing.json | prompts/rubrics/testing-rubric.md |
| Self-improve | reflector + proposal-verifier + grader | schemas/proposal.json | prompts/rubrics/proposal-rubric.md |

**How rubrics work:** The grader agent reads `prompts/rubrics/<phase>-rubric.md` at runtime. If the file doesn't exist, grader falls back to inline criteria. The rubric file is NOT injected by the workflow JS — grader fetches it via Read tool.

**Grader default verdict tiering (two-layer precedence):** The grader's verdict logic follows a two-layer priority. Layer 1 (per-rubric, highest priority): if the rubric file contains a `## Verdict mapping` section, that section is authoritative and the grader follows it exactly — the four tiered rubrics (design, implementation, review, testing) each carry one. Layer 2 (grader default, fallback): for rubrics that lack an explicit `## Verdict mapping` section (research, discover, proposal, investigate), the grader applies its built-in severity-tiered default from `.claude/agents/grader.md`: BLOCK only on a stated P0/non-negotiable/hard-gate criterion; REQUEST_CHANGES on a genuine core gap; APPROVE when no blocker, recording advisory criteria in `gaps_for_agent` but NOT downgrading the verdict. This ensures un-tiered rubrics never stall on advisory nits.

### Worktree isolation + deterministic run branch

Writer agents (`scope-locked-editor`, `pr-author`) run with **`isolation: worktree`** — the runtime sandboxes each one in its own private git worktree that shares the repo's `.git`. The agent's Read/Edit/Write/bash all resolve inside that worktree; it **cannot** touch the main checkout. This is what keeps a run from mutating `main` and lets runs execute in parallel.

Commits persist via a **deterministic run branch**, not a shared worktree dir. The workflow injects `workspaceBootstrap(beadId)` (from `src/fragments/bead-run.js`) into the writer prompt; it runs `git checkout -B zkflow/<beadId>` so commits land on that branch. Because branches live in the shared `.git`, the commits survive after the per-agent worktree is torn down — the ci/pr-author phases (each in their own worktree) reach them via the branch. finish-pr passes the existing PR branch instead (`checkout`, never `-B`).

History: `zk-flow-ts2`. First attempt (#15) *removed* `isolation: worktree` and tried a manual shared `git worktree add $ZKFLOW_WORKDIR/<bead>` + `cd` in the prompt — that failed live: the agent's Edit/Write resolve absolute paths into `main` regardless of shell `cd`, so edits hit `main`. Only runtime `isolation: worktree` sandboxes the whole agent. Concept (per-run persistence) adapted from [openai/symphony](https://github.com/openai/symphony); mechanism is runtime isolation + a deterministic branch.

**How schemas work:** Inlined at build time from `schemas/*.json` via `build.js`. The `agent()` call passes `schema:` which the runtime enforces on agent output. Missing schema = build error.

**How skills flow:** Researcher globs `$ZK_ARTIFACTS_DIR/skills/**/SKILL.md`, selects relevant ones into `selected_skills[]`, and the `renderSkills()` fragment injects them into downstream designer/impl prompts. If `ZK_ARTIFACTS_DIR` is unset, skill injection is skipped with a console warning.

---

## Fail-Fast Guards (env-check.js + guardrails.js)

Workflow startup order:
1. `requireZkArtifacts()` — ZK_ARTIFACTS_DIR set → handoff if missing
2. `BD_PREFLIGHT_PROMPT` — bd initialized → handoff if missing
3. `assertEvidencePresent()` — after research phase, ensure key_findings/selected_skills non-empty
4. `assertTargetFiles()` — after design phase, ensure affirmed_files declared before impl
5. Rubric existence: grader will warn in output if rubric is absent (runtime check, not workflow check)


---

## Component Wiring Diagram

How every component connects at build time and runtime:

```mermaid
graph TD
    subgraph "Build time (npm run build)"
        SRC["src/workflows/*.src.js"]
        FRAGS["src/fragments/*.js"]
        PHASES["prompts/phases/*.md<br/>(inlined as PHASE_PROMPTS)"]
        SCHEMAS_JSON["schemas/*.json<br/>(inlined as SCHEMAS)"]
        BUILD["build.js<br/>assertRubricsExist()<br/>assertPerspectivePromptsExist()"]
        BUILT[".claude/workflows/*.js"]
        SRC --> BUILD
        FRAGS --> BUILD
        PHASES --> BUILD
        SCHEMAS_JSON --> BUILD
        BUILD --> BUILT
    end

    subgraph "Runtime (workflow execution)"
        BUILT --> WF["Workflow JS runs"]
        WF -->|"env-check"| ENV["ZK_ARTIFACTS_DIR check"]
        WF -->|"env-check"| BD["bd preflight"]
        WF -->|"loadPhasePrompt()"| PP["PHASE_PROMPTS.research<br/>PHASE_PROMPTS.implementation<br/>etc."]
        WF -->|"agent()"| AGENT[".claude/agents/*.md"]
        WF -->|"schema:"| SCHEMA["SCHEMAS.research etc."]
        AGENT -->|"reads at runtime"| RUBRIC["prompts/rubrics/*.md"]
        AGENT -->|"reads at runtime"| SKILLS["$ZK_ARTIFACTS_DIR/skills/**"]
        AGENT -->|"reads at runtime"| PERSONA["skills/agent/machines/<alias>/persona.md"]
        AGENT -->|"reads at runtime"| MOC["vault/Map of Contents/*.md"]
        WF -->|"renderSkills()"| SKILL_RENDER["discovery.selected_skills → prompt"]
        WF -->|"guardrails.js"| GUARDS["assertEvidencePresent()<br/>assertTargetFiles()"]
    end

    subgraph "Fail-fast checks"
        BUILD -->|"throws if missing"| CHECK1["rubrics: all 7 exist"]
        BUILD -->|"throws if missing"| CHECK2["review perspectives: all 8 exist"]
        WF -->|"throws if missing"| CHECK3["PHASE_PROMPTS[phase]"]
        WF -->|"throws if ZK_ARTIFACTS_DIR unset"| CHECK4["requireZkArtifacts()"]
        WF -->|"throws if bd broken"| CHECK5["BD_PREFLIGHT_PROMPT"]
    end
```

---

## Feature Workflow: Research → Discover → Design Phase Sequence

```mermaid
sequenceDiagram
    participant U as User
    participant W as /feature workflow
    participant R as researcher agent
    participant D as designer agent
    participant G as grader agent

    U->>W: /feature "add OAuth"
    W->>W: requireZkArtifacts() + bd preflight
    W->>R: loadPhasePrompt('research') + task
    R->>R: investigate codebase, vault, related beads
    R-->>W: research output {key_findings, synthesis, selected_skills}
    W->>W: assertEvidencePresent(research)
    W->>R: buildPersonaSection() + research summary + Map of Contents check
    R->>R: load persona, check Map of Contents, select skills/vault
    R-->>W: discover output {selected_skills, vault_paths, related_beads}
    W->>W: renderSkills(discovery.selected_skills)
    W->>D: loadPhasePrompt('design') + research + discovery + skillsBlock
    D->>D: draft SQCA design
    D-->>W: design output
    W->>W: assertTargetFiles(design)
    W->>G: grade design vs prompts/rubrics/design-rubric.md
    G-->>W: APPROVE / REQUEST_CHANGES / BLOCK
    W->>U: handoff doc → await human approval
    U->>W: /feature startAt=impl bead=<id>
    W->>R: loadPhasePrompt('implementation') + design + research + skillsBlock
```

## Per-workflow reference docs
Each workflow has a dedicated doc (command + args, agents, schemas, fragments, skills/prompts,
gates, + a **mermaid** flow diagram): [`docs/workflows/`](workflows/README.md) -- one file per
workflow + an index grouping them by type and summarizing the 8 schemas.

## Docs
- This architecture overview: `docs/architecture.md`
- Per-workflow reference docs (with mermaid): `docs/workflows/` (see its `README.md`)
- Using zk-flow schemas outside the /workflows runtime: `docs/using-schemas-externally.md`
- Setting up your own artifacts companion: `docs/zk-artifacts-setup.md`
- Project README: `../README.md`

> The original design spec + implementation plan were authored in a separate private
> planning repo; this `docs/` tree is the canonical, self-contained documentation.

## Build & test
- `npm run build` (or `npm install`, via `prepare`) -- generate `.claude/workflows/*.js` from
  `src/workflows/*.src.js`. These files are **gitignored and not committed**; `src/workflows/*.src.js`
  is the source of truth. `build.js` exports `buildWorkflow(name, fragments)` and `fragmentsFor(name)`
  for use in tests.
- `npm test` -- unit tests for the pure fragments (depth map, verdict routing, schemas, arg parsing,
  bd-command builders) plus the **build validity guard** (`tests/build-validity.test.js`), which
  calls `buildWorkflow` for every source and asserts the output (a) contains `export const meta`,
  (b) has no leftover `// @@FRAGMENTS@@` marker, (c) has no `import` lines, and (d) parses.
  The `agent()` orchestration is integration-tested by running the workflows live, not by unit tests.
