Run the feature workflow: `.claude/workflows/feature.js`

Arguments: $ARGUMENTS

Full feature lifecycle: discover -> research -> design -> impl -> CI -> review -> testing. Each phase is grade-gated; grader must APPROVE before advancing. Use `startAt=impl bead=<id>` to resume after human design approval.

**Phases:** Discover -> Research -> Design -> Impl -> CI -> Review -> Testing

**Args:**
- `depth=none|light|standard|full` (default: standard) -- review depth
- `profile=full|small` (default: full) -- `small` runs a lean lifecycle (no design panel, no review council) for small, low-risk additive changes; replaces the former `/small-feature`. For bugs use `/debug`.
- `startAt=discover|research|design|impl|ci|review|testing` -- resume from a specific phase (`startAt=design` is invalid with `profile=small`)
- `bead=<id>` -- bead ID to seed context when resuming
- `skipReview=true` -- skip the review council phase
- `brief=<text>` -- task description to inject at start

**Example:** `/feature brief=Add rate limiting to the API gateway`

**Small example:** `/feature profile=small brief=Add a --json flag to the status command`

**Resume example:** `/feature startAt=impl bead=abc123`
