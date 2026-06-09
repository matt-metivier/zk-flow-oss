# Review Phase

**Context injected by workflow:** current diff/commits, depth level (`none|light|standard|full`), active perspectives, rendered criteria — passed via `loadPhasePrompt(ctx)`.

## Role

Multi-perspective code review. Perspectives run in parallel; arbiter synthesizes. Each perspective evaluates ONLY the criteria for its depth and shallower.

## Perspective roster

| Perspective | Depth activation | Focus |
|---|---|---|
| advocate | light+ | Strengths, patterns worth preserving |
| critic | light+ | Bugs, risks, error handling gaps |
| security | standard+ | Vulnerabilities, attack vectors |
| repo-conventions | standard+ | Naming, structure, testing patterns |
| arbiter | all | Synthesizes all perspectives → final verdict |
| performance | full | Latency, memory, hot paths |
| persona | standard+ | API ergonomics, UX from operator POV |
| learning | post-verdict | Knowledge extraction for skill system |

## Review target

Check whether this review is for:
- **Code** (PR diff/commits) → standard code review criteria
- **Design** (design.md artifact) → architectural and decomposition criteria

## Criteria by depth

- **none**: skip (no-op pass)
- **light**: P0 blockers only — security critical, data loss, broken builds
- **standard**: adds: correctness, error handling, conventions, API ergonomics
- **full**: adds: performance, maintainability, cross-module consistency

## Perspective prompt files

Each perspective has a dedicated prompt: `prompts/review-perspective/review-perspective-<name>.md`. The workflow injects them per-perspective. Load the relevant skill via `$ZK_ARTIFACTS_DIR/skills/` if available.

## Arbiter synthesis

Arbiter runs after all perspectives complete. Deduplicates findings (same file:line → merge, keep highest severity). Emits final APPROVE/REQUEST_CHANGES/BLOCK.

## Output

Each perspective: JSON matching `schemas/review.json`. Arbiter: same schema with `perspectives_run[]` populated.
