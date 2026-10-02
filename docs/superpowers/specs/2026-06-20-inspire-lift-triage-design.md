# INSPIRE Lift Triage — Roadmap Design

Date: 2026-06-20
Source: tooling-eval catalog (zk-artifacts `skills/general/tools/tooling-eval/EVALS.md`), post awesome-opensource-ai batch run (PR #56).

## Problem

The catalog holds **140 INSPIRE repos → 223 liftable patterns** (plus 65 INSPIRE entries with no parseable pattern: older-format or thin). Lifting 223 patterns individually is not the unit of work — the patterns collapse into a small set of zk-flow subsystem improvements where **many repos independently validate the same idea** (convergence = confidence).

## Goal

Fold all 223 patterns + the 65 thin entries into **16 tracked work items**, each routed to a `/improve` (skill/prompt-text lift) or `/feature` (code lift) seam, prioritized by impact × convergence (effort breaks ties). Nothing lost: every pattern lands in items 1-13 or is explicitly swept by housekeeping items 14-16.

## Non-goals

- Not executing any lift in this work. This produces the backlog; each item runs later via its own `/improve` or `/feature`.
- Not changing the catalog or verdicts.
- Not adopting any tool (all are INSPIRE = pattern lift only, no install).

## Seam routing rule

- **`/feature`** when the lift touches code/new-workflow/schema/fragment (e.g. bd-memory.js, src/workflows/*.src.js, new skill scaffolding).
- **`/improve`** when the lift is skill/prompt/rubric TEXT (e.g. tooling-eval SKILL.md, prompts/rubrics/*, model-tiers prompt config, design notes).

## Priority formula

`tier = impact × convergence`, effort as tiebreak.
- impact = does it hit a known zk-flow gap (new eval system needs grader formalization; finer-grained resume; bounded memory retrieval).
- convergence = count of repos independently validating the pattern.
- P0 = high both; P1 = real design win, medium convergence; P2 = useful/low convergence/quick win; P3 = housekeeping + coverage guarantee.

## Work items

### P0 (priority 1)
1. **Rubric-as-typed-tool-schema** — force each grader criterion into a typed tool call (structured verdict, not free text). Seam `/feature` → `prompts/rubrics/` + grader. Signal: OpenHands critic-rubrics, deepeval G-Eval, MetaGPT (~12 repos).
2. **Eval-harness / benchmark scaffolding** — task defs + pass/fail oracle + categorical scoring. Seam `/feature` → new `skills/general/practices/agent-benchmark/` (or eval-tool extension). Signal: inspect_ai, promptfoo, lmms-eval, evalscope, AG-Bench (~15 repos).
3. **Scorer / assertion metric library** for grader. Seam `/improve` → tooling-eval SKILL + grader rubric. Signal: ragas, deepeval, giskard (~10 repos).
4. **Bounded/windowed bd memory retrieval** — cap unbounded history; same-subject + cross-subject windows. Seam `/feature` → `src/fragments/bd-memory.js`. Signal: graphiti, mem0, TradingAgents get_past_context, parlant ARQ (~15 repos).
5. **Per-phase checkpoint + finer-grained resume** — checkpoint phase output after each phase, not only handoff boundaries. Seam `/feature` → bd-memory.js + phase persistence. Signal: langgraph checkpointing, crewAI FlowPersistence, burr (~10 repos).

### P1 (priority 2)
6. **Declarative phase-transition map** — typed-return routing + and_/or_ multi-condition gates instead of hardcoded sequential calls. Seam `/feature` → `src/workflows/*.src.js`. Signal: langgraph conditional-edge, crewAI @router, langroid (7 repos).
7. **Relevance-gated skill/context loading in discover** — per-turn selective context injection, replace full-skill dumps. Seam `/feature` → discover phase + `src/fragments/args.js`. Signal: parlant, octomind, goose, aider (5 repos).
8. **Structured-output discipline audit** — confirm zk-flow's StructuredOutput usage vs lift (grammar-constrained decoding). Seam `/improve` → schemas + discover. Signal: outlines, guidance, xgrammar, marvin (14 repos).

### P2 (priority 3)
9. **Atomic crash-safe artifact writes** — tmp-file + os.replace, HTML-comment hard delimiters. Seam `/feature` → bd-memory.js writer. Signal: TradingAgents (singleton, quick win).
10. **Human-in-the-loop pause-for-operator node** — first-class workflow node type for approval/interrupt. Seam `/feature` → phase driver. Signal: inspect_ai, voltagent, activepieces (3 repos).
11. **Execution tracing alongside bd** — design note; evaluate overlap with bd before any build. Seam `/improve` design note. Signal: langfuse, openllmetry, helicone (6 repos).
12. **MCP sidecar wiring pattern** — scoped (per-workflow) not global MCP wiring. Seam `/improve` → onboard skill. Signal: browser-use, opencode, griptape (4 repos).
13. **Lazy provider-import / model config** — defer SDK import to call time. Seam `/improve` → `src/fragments/model-tiers.js`. Signal: OpenManus, llmtrim, paperclip (4 repos).

### P3 (priority 4) — housekeeping / coverage guarantee
14. **Triage the 50 uncategorized patterns** — re-read, fold into items 1-13 or log revisit_if. Seam `/improve` pass (35 repos).
15. **Audit the 65 zero-pattern INSPIRE entries** — confirm genuinely thin / older-format; log no-action. Seam `/improve` pass.
16. **Sweep remaining strays** (prompt-optimization singleton etc.) — log as revisit_if. No-build.

## Tracking

- One bd issue per item (16 total) in the zk-flow workspace, prefix `zk-flow-`, type `feature` (code) or `task` (text/housekeeping), priority 1-4 mapping P0-P3.
- Dependency edges: items 14-16 (housekeeping) depend on nothing; item 3 depends on item 1 (scorer lib builds on typed-rubric schema); item 5 depends on item 4 (checkpoint builds on memory-retrieval shape). Others independent.
- This spec is the coverage map; bd issues are the run/task memory. Each item executed later by its own `/improve` or `/feature`.

## Coverage check

223 patterns: grader/rubric 66 → items 1-3; memory(semantic/vector) 40 → items 4 + 11 + 14; bd-retrieval 18 → items 4-5; structured-output 17 → item 8; phase-routing 9 → item 6; observability 6 → item 11; MCP 4 → item 12; HITL 3 → item 10; provider 4 → item 13; artifact-safety → item 9; skill-loading 5 → item 7; prompt-opt 1 → item 16; uncategorized 50 → item 14. 65 thin entries → item 15. **No pattern unassigned.**
