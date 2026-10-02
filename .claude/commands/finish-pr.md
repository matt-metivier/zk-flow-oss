Run the finish-pr workflow: `.claude/workflows/finish-pr.js`

Arguments: $ARGUMENTS

Resume and finish an existing pull request: verify PR exists, load prior bead context, impl-fix loop, watch CI, review council, testing. Entry point: `pr=` is required.

**Phases:** Verify -> Impl -> CI -> Review -> Testing

**Args:**
- `pr=<url-or-number>` (required) -- the PR to finish; accepts an integer PR number or a full GitHub PR URL (`https://github.com/owner/repo/pull/N`)
- `bead=<id>` -- bead ID to load prior design/research context across the seam
- `targetEnv=<env>` -- target environment hint passed to impl and CI phases
- `skipReview=true` -- skip the review council phase
- `model=<id>` / `models=<tier:id,...>` -- override model selection for one or all tiers
- `perspectives=<p1,p2,...>` -- comma-separated review perspectives (default: advocate,critic,security,performance,learning; also accepts persona,repo-conventions)

**Example:** `/finish-pr pr=42`

**Resume with context:** `/finish-pr pr=42 bead=abc123`

**Skip review:** `/finish-pr pr=https://github.com/owner/repo/pull/42 skipReview=true`
