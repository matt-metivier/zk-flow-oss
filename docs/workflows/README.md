# Workflows

zk-flow runs a **5-layer model**: a **workflow** (a saved slash command -- the orchestration:
phase order, gate loops, fan-out, handoff boundaries) spawns **agents** (subagent = prompt +
model + tools), and each agent reads a **skill** (domain how-to, loaded by path from
`$ZK_ARTIFACTS_DIR/skills/`), validates its final-message output against a **schema** (the gate
contract), and persists cross-run **memory** (beads = structured run state via `bd`, vault =
prose). The workflow decides what runs next; the agent does the work; the schema gates it. See
[../architecture.md](../architecture.md) for the full layering, the gate/boundary mechanics, and
the build pipeline.

## Workflow types

The 18 workflows fall into six groups.

### Lifecycles
End-to-end pipelines that take a task from intake to a finished change.
- [feature](./feature.md) -- full lifecycle: discover -> research -> design -> (approve) -> impl -> ci -> review -> testing; split across two runs at a human-approval seam (`startAt=impl bead=<id>`). `profile=small` runs a lean variant (discover -> research -> impl -> ci -> testing, no design phase, no review council) -- replaces the former standalone `/small-feature` (removed, was an orphan generated file with no source).
- [refactor](./refactor.md) -- discover -> research -> refactor -> test (restructures code WITHOUT behavior change; codebase-memory-mcp blast-radius before every symbol edit).
- [debug](./debug.md) -- reproduce+root-cause -> fix -> test (diagnoses a symptom to ROOT CAUSE with file:line proof, then fixes it; tighter than a `feature profile=small` run).
- [design](./design.md) -- discover -> research -> design panel -> handoff (produces an approved design, stops before impl).
- [finish-pr](./finish-pr.md) -- resume an open PR (`pr=<url>`): verify PR -> load context -> impl-fix -> ci -> review -> testing.

### Single-purpose
Standalone phases run on their own, not as part of a lifecycle.
- [research](./research.md) -- discover -> research -> handoff (investigate / spike; stops before design).
- [test](./test.md) -- test-research -> test-design -> test-run by `targetEnv` (designs and runs a test strategy as a unit).
- [simplify](./simplify.md) -- a single quality-only pass: apply reuse / dead-code / altitude cleanups directly, tighten the PR description, verify via CI. `pr=<url>` targets an open PR; omit for a local-only pass. Graded against `simplify-rubric.md`, whose hard gate is behaviour-unchanged.

### Sub-workflows / fan-out
Parallel-perspective or adversarial steps that lifecycles call into (and that also run standalone).
- [review](./review.md) -- depth-gated multi-perspective review (none/light/standard/full) -> arbiter synthesis.
- [critique](./critique.md) -- designer -> (devils-advocate || grill) -> response -> 6-perspective council -> grade.
- [grill](./grill.md) -- adversarial griller hunts failure modes across N rounds -> decider synthesizes a survival verdict (one-shot / interview modes).

### Maintenance
- [improve](./improve.md) -- (manual) cluster beads feedback AND `skill_drift[]` from /vault-sync -> propose -> verify -> grade -> stage (never auto-merges).
- [eval-tool](./eval-tool.md) -- evaluate external tools/repos for adoption: intake -> assess -> verdict (adopt / inspire / reject) -> append to the tooling-eval `EVALS.md` catalog -> lift-route to `/improve` or `/feature` at a seam (never auto-merges).

### Ops
Recurring operations on live infrastructure and external services.
- [investigate](./investigate.md) -- production incident investigation: gather observability signals -> map topology -> look up past incidents -> form ranked hypotheses -> propose mitigations. NEVER executes a mitigation; always hands off to a human with `requires_human: true` on every proposal.
- [dashboard](./dashboard.md) -- fetch monitoring dashboard config JSON from a REST API -> apply a requested change -> verify by re-GETting. Optional sibling-dashboard delete. Generic across monitoring tools; Grafana is the concrete reference implementation.

### Knowledge
Sync between the world and the durable stores. They are deliberately split: `/update` ingests
text an adversary can write and never writes files; `/vault-sync` writes files. One command
holding both properties would put adversary-writable input on a file-writing path. Shared
scaffolding lives in `src/fragments/knowledge-sync.js`.
- [update](./update.md) -- session-end sync: resolve this machine's persona, crawl ONLY the sources it declares (telegram/slack/jira/github/gitlab/bitbucket) -> diff against bd memories + vault notes + persona -> write capped `bd remember` deltas, SURFACE stale notes (never rewrites them), flag persona drift. Emits `suggested_commands[]` -- the `/vault-sync repo=<x>` calls that would fix the repo-stale notes it found.
- [vault-sync](./vault-sync.md) -- repo-driven note sync: scope repo -> scan what merged on the default branch since the last sync (git + codebase-memory-mcp) -> diff against existing notes -> **grade the plan** against `vault-note-rubric.md` -> write, then advance a per-repo bd marker so the next run is incremental. The only workflow that writes vault notes; the target repo stays read-only. `repo=all dir=<path>` sweeps a workspace root.
- [remember](./remember.md) -- daily handoff loader: pull and read yesterday's DailyDigest beads across hosts and narrate where each machine left off. The producing half is `scripts/daily-accumulate.sh` (Stop hook) + `scripts/daily-rollup.sh` (launchd timer).

## Schemas

The 8 schemas in [`../../schemas/`](../../schemas/) are the gate contracts: a phase agent's final
message must validate against its schema, and gate loops read the verdict field to decide
satisfied / iterate / escalate.

| Schema | Produced by | Used by workflows |
|---|---|---|
| [research.json](../../schemas/research.json) | researcher | feature, debug, design, research |
| [design.json](../../schemas/design.json) | designer (design panel) | feature, design |
| [implementation.json](../../schemas/implementation.json) | implementer / impl-fix | feature, refactor, debug, finish-pr |
| [review.json](../../schemas/review.json) | grader / arbiter (verdict authority) | feature, finish-pr, review, critique, improve, and every gated phase via `runPhase` |
| [testing.json](../../schemas/testing.json) | test-runner | feature, refactor, debug, finish-pr, test |
| [discover.json](../../schemas/discover.json) | discover agent (selects skills / vault paths / related beads) | feature, refactor, design, research |
| [proposal.json](../../schemas/proposal.json) | reflector | improve |
| [solution.json](../../schemas/solution.json) | solution-extractor / vault-writer | improve (vault extraction) |

`review.json` is the most widely shared: `runPhase` invokes a grader against every iterating
phase's output, so even phases whose own schema has no `verdict` field (research, impl, testing)
still gate on a `review.json` verdict.

## Prompts & rubrics

Phase prompt bodies and grading rubrics live in [`../../prompts/`](../../prompts/):
- `prompts/phases/` -- per-phase agent prompt bodies (discover, research, design, implementation, testing, grill, devils-advocate, self-improvement).
- `prompts/review-perspective/` -- the 5 council perspectives (advocate, critic, security, performance, learning) plus the arbiter synthesis prompt.
- `prompts/dispatch/` -- dispatch/orchestration prompt fragments.
- `prompts/rubrics/` -- grading rubrics the grader/arbiter applies. One per phase name that `runPhase` resolves (`phaseName` or the label's first segment), plus `vault-note-rubric.md` for the /vault-sync plan gate. `build.js` derives the required set from actual usage and fails the build on a missing file — a phase pointing at an absent rubric means the grader is told to read a file that does not exist and scores with no criteria.

These are the rubric source the agents embed; schemas are the machine-checkable contract over the
output those prompts produce.

## Durable context

Persona, prior beads, and the vault Map of Contents reach agents by two paths: the discover
phase (feature, design, research, refactor) or `contextPack()` — one fast-tier call wired
into the nine workflows that have no discover phase. Sections are budget-clamped
(`CONTEXT_BUDGETS`) because the block is injected into every phase prompt of a wired
workflow. See [../architecture.md](../architecture.md#durable-context-persona-prior-beads-vault-moc).

## Per-phase model tiers

Every `agent()` / `runPhase()` call gets an explicit `model:` resolved by `modelFor(phase, a)`
across three tiers -- **fast** (haiku: ci-watch, persist/handoff), **mid** (sonnet: discover,
research, review perspectives, testing), **deep** (opus: design, impl, arbiter/grader synthesis).
Override per invocation with `model=<tier|raw-id>` (global) or `models=<phase>:<tier>,...`
(per-phase; per-phase wins over global). See [../architecture.md#per-phase-model-tiers](../architecture.md).
