# feature

Full feature lifecycle (discover -> research -> design -> impl -> ci -> review -> testing), split across two runs at a human-approval handoff boundary.

## Command

```
/feature <request text...> [startAt=discover|impl] [bead=<id>] [brief=<text>]
         [targetEnv=local|dev|stage|prod] [perspectives=a,b,c]
         [skipReview=true] [model=<tier|id>] [models=phase:tier,...]
```

Run-1: `/feature add rate limiting to the ingest API`
Run-2 (after human approves design): `/feature startAt=impl bead=<id>`

Args actually read by `feature.src.js` (parsed by the `args` fragment; positional tokens collect under `_`):

| Arg | Meaning | Default |
|-----|---------|---------|
| `_` (positional) | The feature request text, joined into the prompt for every phase. | inferred from context |
| `startAt` | Entry point. Only `discover` or `impl` are valid; anything else escalates `needs_human`. `discover` = run-1 (discover->research->design->handoff). `impl` = run-2 (load->impl->ci->review->testing). | `discover` |
| `bead` | Stable per-run bead id correlating the run-1/run-2 seam. REQUIRED for `startAt=impl` (loads prior design+research). Normalized to lowercase/`[a-z0-9._-]`; invalid format escalates `needs_human`. | derived via `runBeadId` (`zkflow-<slug>`) |
| `brief` | Extra brief text appended to research/design/impl/testing prompts. | empty |
| `targetEnv` | Environment the testing phase verifies against (`local`/`dev`/`stage`/`prod`). | `local` |
| `perspectives` | Comma list overriding the review council perspectives (run-2 review only). Filtered by `validPerspectives` (defaults + opt-in `persona`,`repo-conventions`). | the default 5 |
| `skipReview` | `true` bypasses the review council; sets verdict APPROVE and routes straight to testing. | false |
| `model` | Global model override for all phases. Accepts a tier name (`fast`/`mid`/`deep`) or a raw model id. | per-phase tier |
| `models` | Per-phase tier overrides, e.g. `research:deep,impl:fast`. | per-phase tier |

Recognized by the parser's `CONTROL_KEYS` but NOT consumed by this workflow: `depth`, `mode`, `maxIterations`, `window`, `autoApprove`, `pr`. (`pr` only influences bead-id derivation in `runBeadId`; feature's CI loop is not given a PR number, so there is no `gh pr checks <pr>` watch.)

## Flow

```mermaid
flowchart TD
  Start([/feature]) --> GStart{startAt valid?<br/>discover|impl}
  GStart -- no --> NH0[handoff: badstart] --> needs_human([needs_human])
  GStart -- impl, no/invalid bead --> NHb[handoff: nobead/badbead] --> needs_human

  GStart -- discover --> D[Discover<br/>researcher, SCHEMAS.discover]
  D --> RES{{Research loop x2<br/>researcher + grader}}
  RES -- not ok --> NHr[handoff: research] --> needs_human
  RES -- ok --> DD[Design draft<br/>designer, SCHEMAS.design]
  DD --> GR[parallel: devils-advocate + griller]
  GR --> DR[Design response<br/>designer]
  DR --> DLOOP{{Design loop x2:<br/>5 perspectives -> grader<br/>SCHEMAS.review}}
  DLOOP -- not APPROVE in budget --> NHd[handoff: design] --> needs_human
  DLOOP -- APPROVE --> HB[Handoff boundary<br/>pr-author writes handoff doc]
  HB --> DC([design_complete<br/>human approves, rerun startAt=impl])

  GStart -- impl --> LD[Load design from bead<br/>researcher, SCHEMAS.design]
  LD -- null --> NHld[handoff: load-design-failed] --> needs_human
  LD --> LR[Load research from bead<br/>researcher, SCHEMAS.research]
  LR -- null --> NHlr[handoff: load-research-failed] --> needs_human
  LR --> IMPL{{Impl loop x2<br/>scope-locked-editor + grader}}
  IMPL -- not ok --> NHi[handoff: impl] --> needs_human
  IMPL -- ok --> CI{{CI loop x3<br/>evidence-scanner gh pr checks<br/>re-run impl on red}}
  CI -- not passed --> needs_human
  CI -- green --> SK{skipReview?}
  SK -- true --> TEST
  SK -- false --> RV{{Review council loop x3<br/>perspectives -> arbiter<br/>SCHEMAS.review}}
  RV -- routeVerdict --> RVR{verdict}
  RVR -- APPROVE/done --> TEST
  RVR -- REQUEST_CHANGES --> RFIX[re-run impl to fix findings] --> RV
  RVR -- BLOCK/unknown --> NHrev[handoff: review] --> needs_human
  TEST{{Testing loop x2<br/>test-runner + grader<br/>SCHEMAS.testing}}
  TEST -- not ok --> NHt[handoff: testing] --> needs_human
  TEST -- ok --> APPROVE([APPROVE / route=done])
```

## Agents

Each spawn's model is `modelFor(<key>, a)`; tier shown is the default for that key when no `model`/`models` override is passed.

| Agent | Phase / step | Role | Model tier |
|-------|--------------|------|------------|
| `researcher` | Discover; Research loop; run-2 load-design/load-research; persist | Investigates scope, emits discover/research artifacts, reconstructs design+research from the bead; also drives `persistPhase`. | discover `mid`, research `mid`, verify `fast` (load), persist `fast` |
| `designer` | Design draft / response / revisions | Drafts and revises the SQCA design; affirms the skill set. | design `deep` |
| `devils-advocate` | Design (pre-loop, parallel) | One-shot stress-test of the draft design. | grill `mid` |
| `griller` | Design (pre-loop, parallel) | One-shot adversarial challenges to the draft design. | grill `mid` |
| `advocate`,`critic`,`security`,`performance`,`learning` | Design council; Review council | The default-5 review council perspectives, fanned out fresh per loop iteration. | review `mid` |
| `grader` | Research/impl/testing grade; design council synthesis | Synthesizes the per-loop verdict (APPROVE/REQUEST_CHANGES/BLOCK) as a ReviewOutput. | grade `deep` |
| `arbiter` | Review council synthesis | Merges duplicate findings (same line -> highest severity), emits the review verdict. | grade `deep` |
| `scope-locked-editor` | Impl loop; CI-fix re-run; review-fix re-run | Writes/edits code within design scope. | impl `deep` |
| `evidence-scanner` | CI loop | Runs `gh pr checks --watch`, reports green/false. | harness default (no model passed) |
| `test-runner` | Testing loop | Writes and runs tests against `targetEnv`, emits TestingOutput. | testing `mid` |
| `pr-author` | All handoff/escalation exits | Writes the handoff document per the handoff skill. | persist `fast` |

Optional perspectives `persona` and `repo-conventions` are admitted by `validPerspectives` only if passed via `perspectives=`.

## Schemas

`SCHEMAS.*` resolve to `schemas/<x>.json` (inlined at build via the `schemas` fragment). `review.json` is the universal gate schema: every `runPhase` grader and both the design-grader and review-arbiter validate against it.

| Phase / step | Schema | Enforces |
|--------------|--------|----------|
| Discover | `discover.json` (DiscoverOutput) | Required `skills`, `vault_paths`, `related_beads`, `rationale`. |
| Research; run-2 load-research | `research.json` | Required `outcome`, `task_context`, `key_findings`, `evidence_quality` (enum strong/adequate/weak); carries `selected_skills`. |
| Design; run-2 load-design | `design.json` | Required `outcome`, `overview`, `approach`, `test_strategy`; SQCA fields, `affirmed_skills`/`skills_added`/`skills_removed`, `grill_survival`. |
| Impl (and CI-fix / review-fix re-runs) | `implementation.json` | Required `outcome` (enum), `files_changed`, `commits`, `tests_run`, `tests_passed`, `tests_failed`, `approach_rationale`. |
| All phase grades; design-grade; review-arbiter | `review.json` (ReviewOutput) | Required `verdict` (APPROVE/REQUEST_CHANGES/BLOCK), `evidence_quality`, `weighted_score`, `findings`. Drives `routeVerdict`. |
| Testing | `testing.json` (TestingOutput) | Required `outcome` (enum), `smoke_command`, `smoke_exit_code`, `scenarios_exercised`; `target_env` enum. |

CI uses an inline ad-hoc schema `{ required: [green], green:boolean, summary:string }` (from the `ci-loop` fragment), not a file under `schemas/`. `proposal.json` and `solution.json` are exported by the `schemas` fragment but unused by feature.

## Fragments used

Declared via the header `// @@USE: run-phase,handoff,depth-map,verdict,budgets,schemas,args,bd-memory,bead-run,ci-loop,model-tiers` and inlined at build:

- `run-phase` — `runPhase()`: grade-gated bounded loop (run phase agent, then a `grader` emitting a `review.json` verdict; APPROVE exits, else feedback re-runs).
- `handoff` — `handoffPrompt(summary, next)`: builds the prompt telling `pr-author` to write a handoff doc per the handoff skill.
- `depth-map` — `DEFAULT_PERSPECTIVES` (advocate/critic/security/performance/learning) and `validPerspectives()` (filters lists, admits `persona`/`repo-conventions`). (`REVIEW_DEPTHS`/`criteriaForDepth` provided but unused here.)
- `verdict` — `routeVerdict()`: APPROVE->done, REQUEST_CHANGES->impl, BLOCK/unknown->needs_human.
- `budgets` — `PHASE_BUDGETS`: research 2, design 2, impl 2, review/council 3, testing 2, ci 3.
- `schemas` — `SCHEMAS` object re-exporting the JSON schemas.
- `args` — `parseArgs`/`readArgs`: text-or-object args into `{key:val, _:[positional]}`.
- `bd-memory` — `assertId`, `bdShow(id)` (`bd show <id> --json`), `bdWrite(id,type,obj)` (shell snippet appending a typed `<Type>: <json>` comment to the bead).
- `bead-run` — `runBeadId(a)` (stable bead id from `bead`/`pr`/`_`) and `persistPhase(beadId,type,payload)` (writes phase memory via a `researcher` running `bdWrite`).
- `ci-loop` — `runCI()`: bounded CI-watch loop, re-runs impl via `scope-locked-editor` on red; here called with `agentType='evidence-scanner'`, `implRerunGuard:true`, `persistOnGreen:'loop'`, no `pr`.
- `model-tiers` — `MODEL_TIERS` (fast=haiku-4-5, mid=sonnet-4-6, deep=opus-4-8), `PHASE_TIER`, and `modelFor(phase,a)` honoring `model`/`models` overrides.

## Skills & prompts

Skills are pulled at the agent level from `$ZK_ARTIFACTS_DIR/skills/<id>/SKILL.md` (not loaded by the workflow script itself):

- `researcher` searches `$ZK_ARTIFACTS_DIR/skills/**/SKILL.md` and emits `selected_skills[]` (e.g. `general/practices/humanizer`, `agent/machines/<alias>/...`).
- `designer` consumes `selected_skills[]`, reads them directly, may load `agent/machines/<host>/persona.md`, checks the design against `skills/rules.md`, and emits the final `affirmed_skills[]` (+ added/removed) that impl/review/testing then see.
- `scope-locked-editor` and `test-runner` load the affirmed skills rendered into their prompts (and may read `$ZK_ARTIFACTS_DIR/skills/<id>/SKILL.md`).
- `learning` checks existing skills before proposing a new `skill_suggestion`.
- All handoff exits use the handoff skill: `$ZK_ARTIFACTS_DIR/skills/general/practices/handoff/SKILL.md`.

Prompts/rubrics under `prompts/` (read by phase agents and the grader, not inlined by the script):

- Phase bodies: `prompts/phases/{discover,research,design,implementation,testing,self-improvement}.md`.
- Rubrics the `grader`/`arbiter` score against: `prompts/rubrics/{design,review,testing,proposal}-rubric.md` (research/implementation rubrics applied inline if absent).
- Review-perspective prompts: `prompts/review-perspective/review-perspective-{advocate,critic,security,performance,learning,arbiter}.md`.
- Dispatch prompts: `prompts/dispatch/{devils-advocate,grill}.md`.

## Gates & escalation

Budgets (`PHASE_BUDGETS`): research 2, design 2, impl 2, council 3, testing 2, ci 3. Each `runPhase` loop and the design/review/ci loops run up to their budget; exhausting the budget without APPROVE/green is an escalation.

`needs_human` is returned (after `pr-author` writes a handoff doc) when:
- `startAt` is neither `discover` nor `impl`; or `startAt=impl` with missing/invalid `bead`.
- Research, impl, review-fix, or testing fails to pass within budget.
- Design is not APPROVED within its budget.
- Run-2 cannot load a valid design or research artifact from the bead (returns null).
- CI does not go green within budget (or a CI-fix impl fails with `implRerunGuard`).
- Review verdict routes to `needs_human` (BLOCK or unknown via `routeVerdict`).

Review routing (`routeVerdict`): APPROVE -> done (proceed to testing); REQUEST_CHANGES -> re-run impl (`scope-locked-editor`) to address findings, then re-review (within council budget); BLOCK/unknown -> handoff + `needs_human`.

Handoff boundary: run-1 ends after design APPROVE with `pr-author` writing a handoff (bead id, verdict, design, suggested `/feature startAt=impl bead=<id>`) and returns `verdict: design_complete`. A human reviews/approves, then reruns run-2 with the same `bead=` to correlate context. Each completed phase is persisted to the bead via `persistPhase` (Discover/Research/Design/DesignGrade/Impl/CIPassed/CIFix/ReviewFix/ReviewGrade/Testing), plus a `GraderFeedback` entry on `improve` after review. Terminal success returns `verdict: APPROVE, route: done`.
