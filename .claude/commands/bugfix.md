Run the bugfix workflow: `.claude/workflows/bugfix.js`

Arguments: $ARGUMENTS

Bug fix lifecycle: discover -> research -> impl -> CI -> testing. Mirrors feature but skips design and review phases since bugs have known intent.

**Phases:** Discover -> Research -> Impl -> CI -> Testing

**Args:**
- `startAt=discover|research|impl|ci|testing` -- resume from a specific phase
- `bead=<id>` -- bead ID to seed context when resuming
- `brief=<text>` -- bug description to inject at start

**Example:** `/bugfix brief=Fix null pointer in auth middleware when session token missing`
