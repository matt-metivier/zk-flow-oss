Run the feature workflow: `.claude/workflows/feature.js`

Arguments: $ARGUMENTS

Full feature lifecycle: discover -> research -> design -> impl -> CI -> review -> testing. Each phase is grade-gated; grader must APPROVE before advancing. Use `startAt=impl bead=<id>` to resume after human design approval.

**Phases:** Discover -> Research -> Design -> Impl -> CI -> Review -> Testing

**Args:**
- `depth=none|light|standard|full` (default: standard) -- review depth
- `startAt=discover|research|design|impl|ci|review|testing` -- resume from a specific phase
- `bead=<id>` -- bead ID to seed context when resuming
- `skipReview=true` -- skip the review council phase
- `brief=<text>` -- task description to inject at start

**Example:** `/feature brief=Add rate limiting to the API gateway`

**Resume example:** `/feature startAt=impl bead=abc123`
