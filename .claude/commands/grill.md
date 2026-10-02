Run the grill workflow: `.claude/workflows/grill.js`

Arguments: $ARGUMENTS

Adversarial grilling: a griller hunts failure modes and unstated assumptions across N rounds, then a decider synthesizes structured challenges. Use against a design or implementation before committing.

**Phases:** Grill

**Args:**
- `mode=one-shot|interview` (default: one-shot) -- one-shot runs once; interview iterates
- `maxIterations=N` (default: 1 for one-shot, 2 for interview; max 5) -- rounds of grilling

**Example:** `/grill mode=interview maxIterations=3`
