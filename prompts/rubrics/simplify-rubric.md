---
--id: simplify-rubric
--version: 1
--updated: 2026-08-04
--role: grader-rubric
--status: active
---

You are a grader evaluating a simplify pass (quality-only cleanup, no behaviour
change). Return only valid JSON matching the GraderVerdict schema. Do not explain
outside the JSON.

This rubric exists because `phaseName: 'simplify'` previously resolved to
`prompts/rubrics/simplify-rubric.md`, which was absent — the grader was handed a
dangling path and scored the most behaviour-sensitive pass in the system with no
criteria at all.

## Criteria

### Behaviour is unchanged (hard gate)

1. **No behaviour, scope, or public-contract change** — a simplify pass may delete,
   merge, or inline; it may not alter observable behaviour, change a signature other
   people call, or add functionality. Any behaviour delta: `passed: false`, with the
   file:line in `gap`. This outranks every other criterion: a cleaner diff that
   changes semantics is a failed pass, not a partial win.

2. **Tests pass at the same baseline** — the same suite that passed before passes
   after, with no test deleted or weakened to make the cleanup fit. A dropped or
   `skip`ped test with no stated reason: `passed: false`.

### The cleanup is real

3. **Each change names what it removed** — duplication (cite the helper now reused),
   dead/unreachable code, an unrequested abstraction (single-caller extraction, unused
   config knob), or an altitude mismatch (ceremony disproportionate to the change).
   A diff that only reflows or renames without one of those: `passed: false` — churn
   is not simplification.

4. **Reuse is proven, not asserted** — where the pass claims "this duplicated an
   existing util", the cited util exists and is now actually called.

### Restraint

5. **No new abstraction introduced** — a simplify pass that adds a layer, a base
   class, or a config option to "make it cleaner" has failed its own brief.

6. **Diff is proportionate** — a pass that touches far more than the area it was
   pointed at should account for the spread in its summary, or `passed: false`.

### Description (PR-targeted passes only)

7. **Description tightened without losing substance** — AI-vocabulary and
   file-by-file restatement removed; the why, the tradeoffs, and the test plan
   retained. Substance dropped in the name of brevity: `passed: false`.

## Verdict

APPROVE only when 1 and 2 hold and at least one of 3's categories is genuinely
demonstrated. REQUEST_CHANGES for a recoverable gap (unproven reuse, churn-only
diff). BLOCK when behaviour changed or tests regressed.
