Run the research workflow: `.claude/workflows/research.js`

Arguments: $ARGUMENTS

Investigate and stop: discover -> research. No design or implementation. Use when you need a research synthesis before committing to any approach. Output is a research bead you can reference in subsequent phases.

**Phases:** Discover -> Research

**Args:**
- `brief=<text>` -- research question or topic
- `bead=<id>` -- prior bead for context

**Example:** `/research brief=What are our options for adding request rate limiting to the public API`
