Run the test workflow: `.claude/workflows/test.js`

Arguments: $ARGUMENTS

Standalone test strategy: test-research -> test-design -> run. Use against an existing feature or PR to produce and execute a concrete test plan without running the full feature lifecycle.

**Phases:** TestResearch -> TestDesign -> Run

**Args:**
- `targetEnv=local|dev|stage|prod` (default: local) -- environment to run tests against
- `pr=<url>` -- PR URL to cross-reference against CI results
- `bead=<id>` -- bead ID for prior implementation context

**Example:** `/test targetEnv=local`

**Against a PR:** `/test pr=https://github.com/org/repo/pull/42 targetEnv=dev`
