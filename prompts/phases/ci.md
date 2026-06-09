# CI Phase

**Context injected by workflow:** implementation output, PR number/URL (if available), bead ID — passed via `loadPhasePrompt(ctx)`.

## Role

Watch CI, detect failures, trigger targeted fixes. Evidence-scanner reads CI output; if red → impl re-run; loop until green or budget exhausted.

## Steps

1. **Read CI state** — check PR status via gh/glab or detect from bead context.
2. **Classify failures** — test failure vs lint vs build vs flaky:
   - Test failure → impl re-run with failing test cited
   - Lint/fmt → targeted fix (not full impl re-run)
   - Flaky → note and retry once; if still fails → escalate to human
   - Build → impl re-run with build error cited
3. **Impl re-run prompt** — include: which test/check failed, exact error message, file:line if available.
4. **Loop** — repeat until green or `PHASE_BUDGETS.ci` exhausted.
5. **Handoff on exhaustion** — write handoff doc with full CI failure history.

## MCP routing for CI

- GitHub: `mcp__claude_ai_Atlassian__*` or `gh pr checks <number>`
- GitLab: `glab mr checks <iid>` or check Atlassian MCP
- CircleCI: Grafana/observability MCP if configured
- Fallback: `gh run list --branch <branch>` + `gh run view <id>`

## Evidence required

- `ci_passed: true/false`
- `failures[]` — each with: check name, error summary, file:line if available
- `iterations` — how many fix loops ran
- `final_status`: `green | exhausted | flaky_escalated`

## Anti-patterns

- Retrying a flaky test more than once without escalating
- Re-running full impl for a lint-only failure
- Reporting `ci_passed: true` without checking actual CI status

## Output

Emit `{ci_passed, failures, iterations, final_status}` as final message. The workflow validates and routes based on `ci_passed`.
