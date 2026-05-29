Run the critique workflow: `.claude/workflows/critique.js`

Arguments: $ARGUMENTS

Design with adversarial pass + review council. Drafts a design, grills it with adversarial agents, then runs a review council to synthesize a final verdict.

**Phases:** Draft -> Adversarial -> Council

**Args:**
- `depth=none|light|standard|full` (default: standard) -- review council depth
- `brief=<text>` -- design brief / problem statement

**Example:** `/critique brief=Design a distributed rate limiter for the gateway tier`
