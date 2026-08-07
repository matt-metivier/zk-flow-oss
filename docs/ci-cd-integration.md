# CI/CD Integration

zk-flow's `/finish-pr` workflow handles CI watching and PR finalization. It detects which CI provider is available and routes accordingly.

## Supported providers

Detection order (uses whichever MCP or CLI is available):

| Provider | Detection | Tool |
|---|---|---|
| GitHub Actions | `gh` CLI or `mcp__claude_ai_Atlassian__*` | `gh pr checks <number>` / `gh run list` |
| GitLab CI | `glab` CLI or Atlassian MCP | `glab mr checks <iid>` / `glab ci status` |
| CircleCI | Grafana MCP (pipeline metrics) | Loki/Prometheus query for build status |

## CI signal source: remote PR vs. local gate

The `ci-loop` fragment (`runCI`) picks where the green/red signal comes from based on whether a **PR/MR exists** (the `pr` parameter):

| Caller | `pr` passed? | CI signal |
|---|---|---|
| `finish-pr` | yes | **Remote** — watches the PR/MR's CI |
| `feature`, `small-feature` | no | **Local** — runs the project test command (`npm test`); exit 0 ⇒ green |

This is why `feature`/`small-feature` now complete **end-to-end locally** without a pushed PR. Before this, the CI phase only watched remote checks, so a local run with no PR could never observe green and stalled at `needs_human` (phase `ci`/`ci-fix`).

Remote watching detects the host from `git remote get-url origin`:
- **GitHub** (`github.com`) → `gh pr checks <pr> --watch`
- **GitLab** (`gitlab.com` or self-hosted) → `glab ci status --branch <branch>` / `glab pipeline status`; falls back to the GitLab pipelines REST API with `$GITLAB_TOKEN` when `glab` is absent.

## /finish-pr usage

```
/finish-pr pr=<url-or-number>
```

Phases: Verify → LoadContext → Impl-fix (if red) → CI → Review → Testing

## Manual CI check (inside any workflow)

```bash
# GitHub
gh pr checks $PR_NUMBER --watch

# GitLab  
glab mr checks $MR_IID

# Detect what's available
which gh && echo "github" || which glab && echo "gitlab" || echo "no cli"
```

## Wiring CI into other workflows

The `ci-loop` fragment (`src/fragments/ci-loop.js`) runs the CI watch loop. Currently wired into:
- `feature.js` — after impl phase
- `small-feature.js` — after impl phase  
- `finish-pr.js` — primary use

To trigger from GitHub Actions or GitLab CI, call Claude Code headless:

```yaml
# .github/workflows/review.yml
- name: zk-flow review
  run: |
    claude --headless --max-turns 20 "/review depth=standard"
  env:
    ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
    ZK_ARTIFACTS_DIR: ${{ secrets.ZK_ARTIFACTS_DIR }}
```

## Provider detection in finish-pr

The `finish-pr` workflow uses the `ci-loop` fragment which checks:
1. `$GITHUB_TOKEN` / `gh auth status` → GitHub
2. `$GITLAB_TOKEN` / `glab auth status` → GitLab
3. Grafana MCP (`mcp__grafana__*`) → CircleCI/custom via metrics

Add `mcp__grafana__*` to your `.mcp.json` for CircleCI integration via Grafana.
