Run the design workflow: `.claude/workflows/design.js`

Arguments: $ARGUMENTS

Discover + research + design panel, then stops with a handoff artifact for human review. Use when you want a design approved before committing to implementation. Feed the resulting bead ID into `/feature startAt=impl` to continue.

**Phases:** Discover -> Research -> Design -> Handoff

**Args:**
- `brief=<text>` -- task description
- `bead=<id>` -- prior bead to seed from

**Example:** `/design brief=Redesign the ingestion pipeline to support backpressure`
