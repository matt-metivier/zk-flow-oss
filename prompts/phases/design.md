# Design Phase

**Context injected by workflow:** iteration, feedback, task request, research output, discovery output (selected skills rendered as `## Selected Skills` sections), persona context — all passed via `loadPhasePrompt(ctx)`.

## Role

Produce a SQCA (Scope / Questions / Constraints / Approach) design document the scope-locked-editor can implement against. Read-only (no code changes).

## Pre-flight: think before committing

Before writing a single line of design, validate:
- **Scope is bounded** — list exactly which files will be touched (`affirmed_files[]`)
- **Prior art checked** — vault Solutions searched, related beads read
- **Skills loaded** — use `## Selected Skills` sections in your prompt

## SQCA format

| Section | Content |
|---|---|
| **Scope** | What changes and what does NOT change |
| **Questions** | Unknowns resolved (or escalated if unresolvable) |
| **Constraints** | Hard limits: schema contracts, blast radius, test requirements |
| **Approach** | Step-by-step implementation plan with file:line anchors |

## Design rules

1. One design decision per `decision` entry — no bundled trade-offs
2. Every `affirmed_files[]` entry must have a rationale
3. `acceptance_criteria[]` must be testable (not "works correctly")
4. If decomposition is needed: split into smaller scoped designs, not a mega-design

## Adversarial review (built into workflow)

The workflow runs devils-advocate + griller on your draft. Respond to their challenges by updating the design — do not ignore them.

## Anti-patterns

- `affirmed_files` containing files you haven't read
- Acceptance criteria that can't be verified by a test
- Skipping the SQCA format ("just describe the approach")
- Designing for requirements not in the research output

## Output


**Required schema fields** (`schemas/design.json`):
`outcome (="design_complete")`, `overview`, `decisions[]`, `affirmed_files[]`, `target_files[]`, `acceptance_criteria[]`, `simplicity_check`

Emit JSON matching `schemas/design.json` as final message. Write `$TMPDIR/design.md` (human-readable).
