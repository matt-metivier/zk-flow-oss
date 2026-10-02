---
name: onboard-4-tribal
description: Tribal knowledge phase — cross-repo dependencies, PR conventions, how people coordinate, protected branches, deploy processes, and unwritten rules. Run after machine onboarding and person skill enrichment. Produces updated repo skills, RULES.md additions, and a cross-repo dependency map.
---

# onboard-tribal-knowledge

Learns how the engineering organization actually works — the patterns, dependencies, and conventions not written in any single README. The goal is: after this, an agent can open a PR that looks like it belongs, not like it was written by someone who just read the docs.

## When to Use

- After completing `onboard.md` (machine is connected, repos are cloned)
- After person skills have at least one round of enrichment
- When starting work in a new repo or team for the first time
- When you've seen repeated "I didn't know about that dependency" failures

---

## Phase 1 — Discover Cross-Repo Dependencies

Most real changes touch more than one repo. The goal here is to build the dependency map *before* you start work, not discover it mid-PR.

### 1a — Search recent merged PRs for "companion PR" patterns

Look for PRs that mention other PRs or repos in their description:

```bash
# Find PRs that reference other repos or PRs
gh pr list --repo org/platform --state merged --limit 50 --json title,body,url \
  | jq '.[] | select(.body | test("org/|companion|also|depends|k8s-deploys|k8s-declarative|infrastructure")) | {title, url}'
```

**Common cross-repo dependency chains (examples):**
- `platform` operator change → `k8s-deploys` CDK8s manifest update → ArgoCD sync
- `platform` cdk8s change → `k8s-declarative` if it shares a construct
- `platform` pulumi/v3-architecture change → may need `stack-config/` update in same PR
- IAM policy change in `infrastructure` → needed before platform change that uses it (Infrastructure team pattern: IAM companion PR may be required)

### 1b — Search Slack for "cross-repo" or "also need" patterns

```
Slack MCP: search "companion PR" OR "also need to" OR "depends on" in #project-v3-implementation
Slack MCP: search "k8s-deploys" from team members for what they update there
Slack MCP: search "k8s-declarative" for what triggers a synth run
```

### 1c — Check repo protection rules

For each repo, answer: can you push directly to main?

```bash
gh repo view org/platform --json defaultBranchRef --jq '.defaultBranchRef.branchProtectionRule'
# Or just try a push and let the error tell you
```

**Example protection rules:**
- `org/k8s-deploys` — main is protected, requires PR + 4 status checks
- `org/platform` — check before pushing; use feature branches
- `your-github-user/ZkEngine` — push to main is allowed (personal repo)

---

## Phase 2 — Learn the Deploy Process

### 2a — Find the CD pipeline

```bash
ls .github/workflows/ | grep -i deploy
cat .github/workflows/<deploy-workflow>.yml | head -50
```

Look for: what triggers it, what branches deploy where, any manual approval gates.

**Example CD patterns:**
- `k8s-deploys`: ArgoCD watches `main`, auto-deploys on merge
- `platform`: `develop` branch → staging; `master` → prod; CI required before merge
- CDK8s changes: `pnpm synth` must be run locally, `dist/` committed in same PR — ArgoCD reads `dist/` directly

### 2b — Find protected deploy windows

```
Slack MCP: search "merge freeze" OR "deploy freeze" OR "locked develop" in team channels
```

Teams sometimes gate the main deploy pipeline but carve out exceptions for isolated subsystems.

---

## Phase 3 — Learn Review Expectations

### 3a — Who reviews what

Discover who reviews what from PR history and team conventions:
- **Operator code changes**: Component owners
- **RBAC / permissions regeneration**: Security-focused engineers
- **Infrastructure stack changes**: Platform leads
- **CDK8s synthesis**: Pattern reviewers

### 3b — What makes a PR mergeable here

Search recent PRs for what reviewers consistently flag:

```bash
gh pr list --repo org/platform --state merged --limit 30 --json reviews,title,url \
  | jq '.[] | select(.reviews | length > 0) | {title, url, reviewers: [.reviews[].author.login]}'
```

**Patterns observed:**
- **Never hand-edit `dist/`** — only `pnpm synth` output goes there
- **Regenerate RBAC files** when adding new controller verbs
- **Include the Linear ticket** in the PR description (team convention — @Linear bot links threads)
- **Stack configs go in `stack-config/`** alongside the working config
- **Companion PR in `k8s-deploys`** when the operator image version changes

### 3c — PR description conventions

From observed behavior:
- Link the Linear ticket at the top: `Closes KUBEINT-XX` or `Ref: KUBEINT-XX`
- Describe *why*, not just what — Show reasoning in PR descriptions, not just what changed
- For large PRs: use stacked branches to break into reviewable chunks
- Post the PR stack in Slack in the relevant channel after opening

---

## Phase 4 — Learn Tool Conventions

### 4a — Version management

- The team uses `mise` for tool versions — check `mise.toml` in each repo root
- Always run `mise install` (and `mise trust` if needed) before any tooling
- CDK8s: `pnpm synth` is the only supported way to update `dist/`
- Pulumi: Pulumi ESC environments (`AWS-Org/<env>`, `Infra/<env>`) provide credentials — not local AWS profiles directly

### 4b — Linear integration

The team runs `@Linear` bot from Slack:
- `@Linear task for V3` in a thread → creates a ticket immediately
- Mention `[LINEAR-ID]` in commit or PR title to auto-link
- Status updates via Linear's "update" feature (team uses weekly status updates)

### 4c — Incident workflow

From the codebase and Slack patterns:
- Incidents get `#inc-<number>-<description>` Slack channels created automatically
- incident.io manages the incident lifecycle
- Post-incident tasks become Linear tickets automatically from the thread

---

## Phase 5 — Update Repo Skills and RULES.md

After completing the research, update two things:

### 5a — Repo skill Review Council Perspective

For each repo, add or update the **Review Council Perspective** section with:
- Which companion PRs are required (and in which repo)
- What CI checks exist and what they test
- What gets silently broken if you skip the companion PR

### 5b — RULES.md additions

Document the patterns that aren't obvious from reading code:

```markdown
## [Pattern Name]
- Rule: [what to always do / never do]
- Why: [discovered from Slack/PR history]
- Example: [specific PR or incident that illustrates it]
```

---

## Output Checklist

- [ ] Cross-repo dependency map documented in each relevant repo skill
- [ ] Branch protection rules noted in RULES.md
- [ ] Deploy process for each repo documented in repo skill
- [ ] PR description conventions added to RULES.md
- [ ] `pnpm synth` / `dist/` rule in k8s-deploys repo skill
- [ ] Linear bot integration pattern in RULES.md
- [ ] Companion PR requirements in Review Council Perspective of each repo skill

---

## Quick Reference: Cross-Repo Dependency Map (Example)

```
Operator code change (platform/v3-architecture/operator/)
  → build new image → bump version in platform operator config
  → pnpm synth in k8s-deploys/cdk8s/ → commit dist/ → PR to k8s-deploys
  → ArgoCD auto-deploys on merge to k8s-deploys main

CDK8s cluster config change (k8s-deploys/cdk8s/src/)
  → pnpm synth locally → commit dist/ in SAME PR (never hand-edit dist/)
  → PR to k8s-deploys (protected main, needs CI)

New dev cluster
  → pulumi up (management → eks → cluster) in platform
  → copy cluster JSON to k8s-deploys/cdk8s/pulumi-outputs/<env>/<stack>.json
  → pnpm synth → commit → PR to k8s-deploys

IAM / permission change
  → Infra-ops team owns this in infrastructure repo
  → Must precede the platform change that requires it (not concurrent)

RBAC change in operator
  → Regenerate with controller-gen (make manifest)
  → Commit regenerated files in same PR 
```
