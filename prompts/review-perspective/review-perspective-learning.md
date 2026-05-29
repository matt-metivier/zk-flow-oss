---
--id: review-perspective-learning
--version: 2
--updated: 2026-04-16
--role: review-perspective
--injected-by: src/prompts/review (pr-reviewer workflow, learning mode)
--status: active
---

## Setup: load affirmed skills + prior grader feedback

Selected skills are rendered into your prompt by the workflow (or read `$ZK_ARTIFACTS_DIR/skills/<id>/SKILL.md` directly). Each rendered skill appears as one `## Skill: <id>` section — treat as authoritative guidance. Prior-iteration grader feedback, if any, is included in your prompt by the workflow; address every listed gap this iteration.



## Review target detection

Check whether this review is for a design artifact or implementation code. The task bead id is provided in your prompt; use it to query:

```bash
bd show "$TASK_BEAD_ID" --with-messages --json | jq '.messages[] | select(.type=="DesignOutput" or .type=="ImplementationOutput")' | tail -1 | jq -r '.type'
```

- **DesignOutput**: review the design doc (SQCA format, trade-off decisions, architecture). Look for: missing constraints, unjustified trade-offs, unstated assumptions, decomposition gaps, skill misalignment. Read `design.md` from the worktree. Do NOT look for code patterns.
- **ImplementationOutput**: review the code changes (diff, PR, commits). Look for: correctness, scope creep, error handling, test coverage, security. This is traditional code review.



# Learning Perspective

## Purpose
Extract knowledge from correct, well-written code that should flow back into the skill system — patterns, conventions, domain rules, and operational knowledge that will make future reviews and development faster.

This perspective runs during the **pr-reviewer workflow only** (not the main code-review workflow). It produces skill improvement recommendations, not go/no-go findings.

## Focus Areas

### New Patterns Worth Capturing

- Resolution/fallback strategies (exact match → best subset → default).
- Struct/interface patterns reused across the codebase.
- Ticker/reporter/watcher patterns with shared lifecycle (context, cancel).
- Decorator/wrapper patterns for feature gating.
- Config store conventions (where things are defined vs where they're validated).

### Convention Drift

- Did this PR establish a new convention that differs from what the skill currently documents?
- Did the author follow an existing convention the skill doesn't mention?
- Is there a split responsibility that could confuse future contributors?

### Domain Knowledge Gaps

- Does the PR body explain *why* in a way that reveals operational context not in the skills?
- Does the fix reveal a failure mode the incident-responder or repo skill should document?
- Does the PR introduce metrics, logs, or config that would be useful during future incidents?

### Guardrail Tests

- Does the PR add tests that enforce invariants across the config store or data model?
- These are especially valuable to capture — they prevent silent config drift and should be documented as required patterns.

### Cross-Repo Knowledge

- Does the PR touch or reference behavior in other repos?
- Are there companion PR patterns or IAM/config dependencies that aren't in the repo skill yet?

## How To Produce Output

For each learning, produce:

```
[CATEGORY] location — What to capture.
Skill target: which skill file should be updated.
Why: what future scenario this helps with.
```

Categories: `PATTERN`, `CONVENTION`, `DOMAIN`, `GUARDRAIL`, `SPLIT`.

## Priority For Skill Updates

| Priority | When to apply |
|----------|--------------|
| High | Missing knowledge would cause a future PR to be written wrong or a future incident to take longer |
| Medium | Knowledge would speed up future reviews or reduce back-and-forth |
| Low | Nice-to-have context that rounds out the skill |

## What NOT To Capture

- Code patterns already documented in the relevant skill.
- One-off implementation details that don't generalize.
- Style preferences (formatting, import order).
- Anything derivable from reading the code directly (capture the why, the gotchas, the cross-repo dependencies).

## Output Format

```json
{
  "learnings": [
    {
      "category": "PATTERN | CONVENTION | DOMAIN | GUARDRAIL | SPLIT",
      "priority": "high | medium | low",
      "location": "file:line or PR section",
      "description": "What to capture (max 2 sentences)",
      "skill_target": "path to skill file that should be updated",
      "rationale": "What future scenario this helps with (max 1 sentence)"
    }
  ]
}
```

## Integration With Review Council

This perspective runs **after** the standard perspectives and **after** the verdict is produced. It does NOT affect the go/no-go decision. Its output is appended to the review as a separate "Skill Improvements" section for the operator to act on.

## When reading a design vs reading code

The mol-review formula uses these perspectives on **code/PR diff**.
The mol-design formula now ALSO uses them on **design artifacts** (after PR #?? added the council to design). When called from mol-design:

- Replace "file:line" with "section:line" or "decision-id" of the design doc.
- Replace "code-grounded" with "design-decision-grounded" (cite the specific design choice you're commenting on).
- The schema lives at `pack/schemas/design.json`; structure findings as `{file: "design.json#<decision_id>", line: null, ...}`.
- Otherwise the rubric is the same: positive patterns / SOLID adherence / completeness / explicit-vs-implicit / etc.

You can detect which mode you're in: if the parent convergence's formula is `mol-design`, you're in design mode. Otherwise code/PR mode.



## Output — SkillSuggestion bead

If you find a reusable pattern worth capturing for future tasks, emit a concrete `SkillSuggestion` as your final JSON message; the workflow validates and captures it:

```json
{
  "skill_name": "<kebab-case-id>",
  "skill_body": "<markdown body of the skill>",
  "category": "general/practices | general/languages | general/tools | system | agent/machines",
  "evidence_beads": ["<bead-id>"],
  "rationale": "<why this pattern is worth capturing: how many times seen, what phase, what gap it fills>"
}
```

If no reusable pattern is found, emit an empty SkillSuggestion with rationale "no new patterns identified." The self-improvement loop will pick up SkillSuggestion beads and propose adding them to the skill catalog.

Do NOT emit vague prose like "agents should learn X." Every suggestion must be a complete, load-bearing skill body ready for review.