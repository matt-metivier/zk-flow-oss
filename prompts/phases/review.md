# Review Phase

**Context injected by workflow:** current diff/commits, depth level (`none|light|standard|full`), active perspectives, rendered criteria — passed via `loadPhasePrompt(ctx)`.

## Role

Multi-perspective code review. Perspectives run in parallel; arbiter synthesizes. Each perspective evaluates ONLY the criteria for its depth and shallower.


## Deterministic pre-review (run before perspectives — from open-code-review methodology)

Hard constraints that engineering logic handles better than agent judgment:

### File selection (deterministic)

```bash
# Get the exact changeset — don't let agent decide scope
git diff --name-only HEAD~1..HEAD 2>/dev/null || git diff --name-only --cached
```

For each changed file, also read:
- Its test file (if exists at conventional path: `test_*.py`, `*_test.go`, `*.test.ts`)
- Its sibling files that share state (same module, closely coupled)

Do NOT let the agent skip files due to size or complexity. Every changed file gets reviewed.

### Related-file bundling

Group logically-related files into one review unit before running perspective agents.
Example: `message_en.properties` + `message_zh.properties` → review together.
Example: `auth.go` + `auth_test.go` → review together.

This prevents missing context that only appears when reading related files side-by-side.

### Reflection pass (after all perspectives complete)

Before emitting final verdict, run a line-accuracy check:
- For each finding with a `file:line` reference: verify the line still exists and matches the finding
- If line number is wrong (common with large diffs): correct it or mark `line: null` with `context:` field
- Position drift is the most common review failure mode (open-code-review production data)

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
