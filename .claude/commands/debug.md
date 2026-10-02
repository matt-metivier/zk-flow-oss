Run the debug workflow: `.claude/workflows/debug.js`

Arguments: $ARGUMENTS

Debug lifecycle: reproduce+root-cause -> fix -> test. Diagnoses a reported symptom to its ROOT CAUSE with file:line evidence, then fixes it and verifies with a regression test. tighter than small-feature -- starts from a symptom, not a task.

**Phases:** Reproduce -> RootCause -> Fix -> Test

**Args:**
- `brief=<text>` -- the symptom or bug report (preferred over positional; injected into all phase prompts)
- `bead=<id>` -- bead ID to correlate runs
- `model=<tier|id>` -- global model override (fast/mid/deep or raw model id)
- `models=<phase:tier,...>` -- per-phase tier overrides, e.g. `models=research:deep,impl:fast`

**Example:** `/debug brief=Login returns 500 when email contains a plus sign`
