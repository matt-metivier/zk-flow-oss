# Phase Component Model

Every workflow phase has 7 required components. All 7 must be present for the phase to work correctly.

```
Phase = prompt + agent + schema + grader + rubric + skills + guardrails
```

## Component reference

| Component | File location | How loaded | Fail if missing |
|---|---|---|---|
| **Phase prompt** | `prompts/phases/X.md` | Build-time: `PHASE_PROMPTS['X']` via `phasePromptsLiteral()` | BUILD FAILS |
| **Agent** | `.claude/agents/X.md` | Runtime: Claude Code dispatches `agentType:'X'` | Runtime error |
| **Schema** | `schemas/X.json` | Build-time: `SCHEMAS.X` via `schemasLiteral()` | BUILD FAILS |
| **Grader** | `.claude/agents/grader.md` | Runtime: `runPhase()` always runs grader | — (always runs) |
| **Rubric** | `prompts/rubrics/X-rubric.md` | Build-time assertion + grader reads at runtime | BUILD FAILS |
| **Skills** | `$ZK_ARTIFACTS_DIR/skills/` | Runtime: `renderSkills(discovery.selected_skills)` | THROWS if ZK_ARTIFACTS_DIR set |
| **Guardrails** | `src/fragments/guardrails.js` | Runtime: `runPhase()` auto-calls assertPhaseOutput + assertFindings | THROWS |

## What runs automatically (no manual wiring needed)

- `assertPhaseOutput()` — auto-called in `runPhase()` after every agent invocation
- `assertFindings()` — auto-called in `runPhase()` after every grader call
- GraderFeedback → bd persist — auto-called in `runPhase()` when `beadId` provided

## What requires manual wiring in workflow JS

- `assertEvidencePresent(output, phase)` — after research/discover phases
- `assertEvidenceQuality(output, phase)` — after research phases
- `assertTargetFiles(output, phase)` — after design phase (before impl)
- `assertDiscoverValid(output, phase)` — after discover phase
- `assertSelectedSkillsValid(skills, phase)` — before `renderSkills()`

## Enforcement at each lifecycle stage

```
npm run build
  → phasePromptsLiteral(): all prompts/phases/*.md must exist
  → schemasLiteral(): all schemas/*.json must exist
  → assertRubricsExist(): all prompts/rubrics/*-rubric.md must exist
  → assertPerspectivePromptsExist(): all prompts/review-perspective/*.md must exist

npm test
  → doc-accuracy.test.js: workflow catalog vs src, agent refs, rubric files

Runtime (workflow JS)
  → env-check.js: ZK_ARTIFACTS_DIR present
  → BD_PREFLIGHT_PROMPT: bd initialized
  → runPhase(): assertPhaseOutput + assertFindings automatic
  → skill-render.js: throws if skills fail to load when ZK_ARTIFACTS_DIR set
```

## Agent template for perspective agents

See: `$ZK_ARTIFACTS_DIR/skills/agent/templates/perspective-agent-template.md`

Required sections (all 8):
1. Frontmatter (name, description, model, tools)
2. Output budget line
3. Role sentence
4. Depth gate (none/light/standard/full criteria)
5. Setup (skills + prior feedback)
6. Review target detection
7. Perspective-specific criteria
8. Skill reference + What NOT to do + Output contract
