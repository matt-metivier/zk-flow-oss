Run the review workflow: `.claude/workflows/review.js`

Arguments: $ARGUMENTS

Multi-perspective code review. Five reviewers (advocate, critic, security, performance, learning) run in parallel then an arbiter synthesizes a single verdict.

**Phases:** Perspectives -> Synthesis

**Args:**
- `depth=none|light|standard|full` (default: standard) -- criteria tier to evaluate
- `perspectives=comma-list` (default: all 5) -- which reviewer types to include

**Example:** `/review depth=light perspectives=critic,security`
