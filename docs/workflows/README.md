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

The 12 workflows fall into four groups.

### Lifecycles
End-to-end pipelines that take a task from intake to a finished change.
- [feature](./feature.md) -- full lifecycle: discover -> research -> design -> (approve) -> impl -> ci -> review -> testing; split across two runs at a human-approval seam (`startAt=impl bead=<id>`).
- [bugfix](./bugfix.md) -- discover -> research -> impl -> ci -> testing (no design phase, no review council).
- [refactor](./refactor.md) -- discover -> research -> refactor -> test (restructures code WITHOUT behavior change; CGC blast-radius before every symbol edit).
- [debug](./debug.md) -- reproduce+root-cause -> fix -> test (diagnoses a symptom to ROOT CAUSE with file:line proof, then fixes it; tighter than bugfix).
- [design](./design.md) -- discover -> research -> design panel -> handoff (produces an approved design, stops before impl).
- [finish-pr](./finish-pr.md) -- resume an open PR (`pr=<url>`): verify PR -> load context -> impl-fix -> ci -> review -> testing.

### Single-purpose
Standalone phases run on their own, not as part of a lifecycle.
- [research](./research.md) -- discover -> research -> handoff (investigate / spike; stops before design).
- [test](./test.md) -- test-research -> test-design -> test-run by `targetEnv` (designs and runs a test strategy as a unit).

### Sub-workflows / fan-out
Parallel-perspective or adversarial steps that lifecycles call into (and that also run standalone).
- [review](./review.md) -- depth-gated multi-perspective review (none/light/standard/full) -> arbiter synthesis.
- [critique](./critique.md) -- designer -> (devils-advocate || grill) -> response -> 6-perspective council -> grade.
- [grill](./grill.md) -- adversarial griller hunts failure modes across N rounds -> decider synthesizes a survival verdict (one-shot / interview modes).

### Maintenance
- [improve](./improve.md) -- (manual) cluster beads feedback -> propose -> verify -> grade -> stage (never auto-merges).

## Schemas

The 8 schemas in [`../../schemas/`](../../schemas/) are the gate contracts: a phase agent's final
message must validate against its schema, and gate loops read the verdict field to decide
satisfied / iterate / escalate.

| Schema | Produced by | Used by workflows |
|---|---|---|
| [research.json](../../schemas/research.json) | researcher | feature, bugfix, debug, design, research |
| [design.json](../../schemas/design.json) | designer (design panel) | feature, design |
| [implementation.json](../../schemas/implementation.json) | implementer / impl-fix | feature, bugfix, refactor, debug, finish-pr |
| [review.json](../../schemas/review.json) | grader / arbiter (verdict authority) | feature, finish-pr, review, critique, improve, and every gated phase via `runPhase` |
| [testing.json](../../schemas/testing.json) | test-runner | feature, bugfix, refactor, debug, finish-pr, test |
| [discover.json](../../schemas/discover.json) | discover agent (selects skills / vault paths / related beads) | feature, bugfix, refactor, design, research |
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
- `prompts/rubrics/` -- grading rubrics the grader/arbiter applies (design, proposal, review, testing).

These are the rubric source the agents embed; schemas are the machine-checkable contract over the
output those prompts produce.

## Per-phase model tiers

Every `agent()` / `runPhase()` call gets an explicit `model:` resolved by `modelFor(phase, a)`
across three tiers -- **fast** (haiku: ci-watch, persist/handoff), **mid** (sonnet: discover,
research, review perspectives, testing), **deep** (opus: design, impl, arbiter/grader synthesis).
Override per invocation with `model=<tier|raw-id>` (global) or `models=<phase>:<tier>,...`
(per-phase; per-phase wins over global). See [../architecture.md#per-phase-model-tiers](../architecture.md).
