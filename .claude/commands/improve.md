Run the improve workflow: `.claude/workflows/improve.js`

Arguments: $ARGUMENTS

Manual improvement pipeline: analyze GraderFeedback beads -> propose changes -> verify -> grade -> stage as a git branch. Never auto-merges. Requires at least 5 lifecycle runs worth of bead history to have signal.

**Phases:** Analyze -> Reflect -> Verify -> Grade -> Stage

**Args:**
- `window=N` (default: 10) -- how many recent beads to analyze
- `autoApprove=true` -- skip human confirmation before staging

**Example:** `/improve window=20`
