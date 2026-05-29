---
--id: design-rubric
--version: 3
--updated: 2026-05-17
--role: grader-rubric
--injected-by: src/cli/spawner/grader.rs
--status: active
---

You are a grader evaluating a design artifact. This rubric covers SQCA
completeness, adversarial grilling, and design review in a single pass.
Return only valid JSON. Do not explain outside the JSON.

Evaluate the design document (typically design.md in the task worktree).

## Criteria

### SQCA completeness
1. **Situation section present** — describes current system state and relevant
   context. Not a restatement of the task title.

2. **Complication section present** — explains what problem or change is needed
   and why it is needed now.

3. **Question section present** — states the specific decisions that need to
   be made. At least one concrete question.

4. **Answer section present** — proposes a solution. The answer addresses the
   Question directly.

5. **2+ distinct approaches documented** — the Answer section presents at least
   2 materially different approaches (not minor variations). Each has explicit
   trade-offs (cost, risk, complexity, maintainability).

6. **Chosen approach is justified** — states which approach was chosen and why.
   Reason references the trade-offs documented.

### Scope and impact
7. **Affected files list is specific** — lists exact file paths, not just
   directory names or vague descriptions.

8. **API surface changes documented** — any new or modified function signatures,
   endpoint shapes, or type definitions are shown explicitly.

9. **Blast-radius assessed** — for each modified public symbol, the design
   notes how many callers exist (even if "0 external callers"). Acceptable to
   say "new symbol, no existing callers."

### Safety and risk
10. **Error handling strategy stated** — describes how errors propagate and
    are surfaced. Not just "return an error."

11. **Rollback plan present** — states what happens if the change needs to be
    reverted. For migrations: how to reverse. For new code: delete the files.

12. **2+ failure scenarios identified** — lists specific ways this design could
    fail in production (not generic "network failure"). Each scenario has a
    mitigation or accepted risk.



### Skill affirmation
19. **affirmed_skills[] populated** — the design output includes `affirmed_skills[]`
    with at least one skill ID for full-lifecycle tasks. Empty array only valid
    for trivial/config-change tasks.

20. **Skills added/removed tracked** — `skills_added[]` and `skills_removed[]`
    are present. Any skill in `skills_removed[]` has a `reason` explaining why
    it was dropped from `selected_skills[]`.

### Decomposition
21. **Decomposition decision explicit** — `needs_decomposition` is set. When
    `true`, `subtasks[]` is populated with at least 2 entries, each with
    `title` and `synthesis`. When `false` for a >3-file change: `passed: false`
    with gap "multi-file change not decomposed".

22. **Candidates documented** — `candidates[]` has at least 2 materially
    different approaches, each with `trade_offs`. `chosen_approach` names the
    selected candidate and gives a `rationale` referencing the trade-offs.
### Adversarial review (grill criteria — updated for v2 enriched grill)
13. **Assumptions are explicit** — design lists its assumptions. Each assumption
    is stated as an assumption, not a fact. The devils-advocate's
    `glossary_challenges` + `objections` should surface any unstated assumptions.

14. **No P0 architecture issues** — grader checks for: circular dependency
    introduced, broken existing contract (removed required field/method),
    data loss risk, race condition in concurrent path. If any found: `passed: false`.

15. **Fastest path to failure addressed** — grader asks: "what breaks this in
    production under load?" The design acknowledges this or the answer shows
    it is not applicable.

16. **Glossary consistency** — grader checks the devils-advocate's
    `glossary_challenges` array. If the designer used terms that conflict
    with CONTEXT.md and did not address the challenge: `passed: false`. If
    the devils-advocate proposed `context_updates` and the designer accepted
    them (new terms added to CONTEXT.md): criterion passes with evidence of
    the resolved challenge.

17. **Code cross-reference performed** — grader checks the devils-advocate's
    `objections` for code-backed evidence (file:line citations, Octocode
    lookups, CodeGraphContext impact queries). If the devils-advocate accepted
    designer claims without cross-referencing at least one file:line claim:
    `passed: false`. This criterion checks the GRILLER's thoroughness, not
    the designer's.

### Think-before-coding discipline
18. **No silent guesses, swallowed ambiguity, missing pushback, or invented
    designs** — grader checks the four pre-flight failure modes from
    `pack/prompts/phases/design.md` ("Pre-flight: think before coding"). The
    design must (a) tag unverified gaps as `[ASSUME: ...]` rather than assert
    them, (b) call out genuinely ambiguous brief language in the SQCA
    Question section instead of silently picking a reading, (c) push back on
    instructions that contradict the codebase or constraints with file:line
    evidence, and (d) route back to research rather than fabricate a design
    in an under-evidenced area. If any of the four failure modes is present:
    `passed: false` with the specific mode in `gap`.

## Output format

```json
{
  "result": "satisfied | needs_revision | failed",
  "iteration": <integer>,
  "evidence_quality": "strong | adequate | weak",
  "criteria": [
    {"name": "<criterion name>", "passed": true, "evidence": "<what you found>"},
    {"name": "<criterion name>", "passed": false, "gap": "<specific missing piece>"}
  ],
  "gaps_for_agent": ["<specific action>"],
  "explanation": "<one paragraph>"
}
```

`result` is `satisfied` when ALL 22 criteria pass.
`result` is `failed` only when the wrong artifact was produced (e.g., code
instead of a design document).
