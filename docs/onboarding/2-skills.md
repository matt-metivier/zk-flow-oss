---
name: onboard-2-skills
description: Context and knowledge layer — create persona.md, build repo skills, and load domain skills for the team. Run after Phase 1 (machine connected and spawner running). See skills/agent/machines/<hostname>/ for a complete example.
---


> **How these become visible to Claude Code.** Claude Code discovers skills exactly one level
> deep — `~/.claude/skills/<name>/SKILL.md`. This tree nests up to five levels
> (`skills/agent/machines/<host>/nebo/<tool>`), so nothing here is discoverable on its own.
> Two mechanisms bridge that, both keyed off `skills/CATALOG.md`:
>
> 1. **Workflow prompts** — the discover phase selects catalog ids and `renderSkills` cats them
>    into downstream agent prompts. Workflows without a discover phase call
>    `selectAndRenderSkills` (one fast-tier catalog prefilter + select + load).
> 2. **Interactive sessions** — `zk-flow/scripts/install-skills.sh` symlinks each catalog skill
>    to `~/.claude/skills/zk-<name>`, so it is invocable as `/zk-<name>` and appears in the
>    model's skill listing. Host-scoped by default (other machines' and archived skills are
>    skipped; `--all` includes them).
>
> `/onboard` runs the catalog freshness check and the install; `/health` fails when either has
> drifted. Re-run `/onboard` after adding, renaming, or collapsing a skill, and restart the
> session to pick new ones up.

# Phase 2 — Skills

Build the knowledge layer that shapes how the agent thinks and works on this machine: the persona file, repo-specific conventions, and domain skill sets.

---

## Step 1 — Verify Machine Skills Directory

After Phase 1 the directory should already exist. Confirm:

```bash
MACHINE_ID=$(hostname)
ls skills/agent/machines/$MACHINE_ID/
```

Expected: `persona.md` and a `repos/` subdirectory. If missing, re-run Phase 1 Steps 3 and 4.

---

## Step 2 — Complete persona.md

The persona file created in Phase 1 contains placeholders. Fill every section with real values before proceeding.

**Required sections:**
- `machine` — hostname of this box (`hostname`)
- `Endpoints` table — confirm each address is reachable (Phase 1 connectivity check)
- `Environment` — actual paths to credential files on this machine
- `People` — names of teammates whose person skills should be loaded at boot
- `Repos` — all repos this machine will work in, with their absolute paths and skill references

**Reference:** `skills/agent/machines/<hostname>/persona.md` is a complete example. Use it as the template.

---

## Step 3 — Create Layered Repo Skills

A repo skill encodes the conventions an agent needs to work safely in a specific repository: test commands, linting, CI expectations, module layout, PR review checklist, and what will get a PR rejected.

**Repo skills are always layered.** Do not create a single flat repo markdown file. Every repo skill must have:

- `SKILL.md` — trigger, purpose, boundaries, and layer index
- `layers/core.md` — stable repo invariants and module map
- `layers/conventions.md` — build/test/lint, PR, CI, and review workflow
- `layers/gotchas.md` — production failures, fragile paths, and silent breakages

For each repo listed in `persona.md`:

```bash
MACHINE_ID=$(hostname)
REPO_NAME=<repo-name>
SKILL_DIR="skills/agent/machines/$MACHINE_ID/repos/$REPO_NAME"

mkdir -p "$SKILL_DIR/layers"

cat > "$SKILL_DIR/SKILL.md" << 'EOF'
---
name: <hostname>-<repo-name>
description: Use when working in <repo-name> on <hostname>.
---

# <repo-name>

Use this skill when the task targets `/absolute/path/to/repo` or mentions `<repo-name>`.

## Purpose

Load the repo-specific context needed to change, test, review, and ship this repository safely.

## Layers

| Layer | File | Load When |
| --- | --- | --- |
| Core | `layers/core.md` | Always when this repo skill is selected |
| Conventions | `layers/conventions.md` | When implementing, reviewing, or preparing a PR |
| Gotchas | `layers/gotchas.md` | When debugging, deploying, or touching fragile modules |

## Boundaries

- Keep company-wide or language-wide guidance in shared skills.
- Keep machine-only paths in this repo skill or the machine persona.
- Move durable incidents and recurring mistakes into `layers/gotchas.md`.
EOF

cat > "$SKILL_DIR/layers/core.md" << 'EOF'
---
--id: agent/machines/<hostname>/repos/<repo-name>/core
layer: core
---

# <repo-name> — Core

## Repository

- **path**: /absolute/path/to/repo
- **remote**: git@github.com:<org>/<repo>.git
- **default branch**: main / master / develop (check)
- **branch protection**: yes / no — describe rules

## Module Layout

Describe the key directories and what lives where.

## Stable Invariants

- Rules that are true regardless of the current task.
- Ownership boundaries the agent must not cross casually.
- Public interfaces or persisted data formats that require compatibility.
EOF

cat > "$SKILL_DIR/layers/conventions.md" << 'EOF'
---
--id: agent/machines/<hostname>/repos/<repo-name>/conventions
layer: conventions
---

# <repo-name> — Conventions

## Build and Test

```bash
# Commands to build, test, and lint this repo
```

## CI Checks

| Check | What it validates |
|-------|------------------|
| <check-name> | <description> |

## PR Conventions

- Branch naming: `<pattern>`
- PR title format: `<pattern>`
- Required reviewers: <who>
- Linear ticket: required / optional

## Testing Strategy

- Which tests prove local correctness.
- Which tests are slow or flaky and when to run them.
- Which generated files or snapshots must be refreshed.
EOF

cat > "$SKILL_DIR/layers/gotchas.md" << 'EOF'
---
--id: agent/machines/<hostname>/repos/<repo-name>/gotchas
layer: gotchas
---

# <repo-name> — Gotchas

## Review Council Perspective

- **Companion PRs required**: list any repos that need a paired PR
- **What CI validates**: list checks and what they test
- **What breaks silently if skipped**: any non-obvious dependencies

## Known Failure Modes

- Production failures seen before and how to avoid repeating them.
- Fragile paths that need extra verification.
- Commands that look safe but mutate shared state.
EOF
```

**Reference examples:**
- `skills/agent/machines/<hostname>/repos/my-project.md`
- `skills/agent/machines/<hostname>/repos/k8s-deploys.md`
- `skills/agent/machines/<hostname>/repos/platform.md`

---

## Step 4 — Load Layered Domain Skills

Domain skills are global skill files that teach the agent a specific technology or discipline. They live in `skills/agent/machines/<hostname>/` alongside the persona.

**Domain skills are always layered.** Use `skills/agent/scaffolding/skill-template.md` for `SKILL.md` and `skills/agent/scaffolding/layer-template.md` for each layer. The minimum accepted structure is:

```text
skills/agent/machines/<hostname>/<skill-name>/
├── SKILL.md
└── layers/
    ├── core.md
    ├── conventions.md
    └── gotchas.md
```

### 4a — Identify needed domain skills

Look at the repos this machine will work in. For each technology stack, check whether a domain skill already exists:

```bash
# List existing domain skills for other machines as reference
ls skills/agent/machines/<hostname>/
ls skills/agent/machines/<hostname>/
```

Common domain skills already available (copy or reference these):
- `golang-development/SKILL.md` — Go patterns, testing, module conventions
- `kubernetes-specialist/SKILL.md` — K8s, ArgoCD, CDK8s, Helm patterns
- `clickhouse/SKILL.md` — ClickHouse schema, query patterns, migration approach
- `pulumi/SKILL.md` — Pulumi stack operations, ESC environments
- `incident-responder/SKILL.md` — Incident triage, runbook patterns
- `cloud-tools/SKILL.md` — AWS CLI, Terraform, general cloud tooling
- `grafana/SKILL.md` — Dashboard building, alerting, PromQL

### 4b — Reference vs copy

If a domain skill already exists on another machine and covers your stack:
1. Reference it in `persona.md` under the relevant repo's `skills:` field
2. Do not duplicate the file — load it directly

If the stack is unique to this machine, create a new skill:

```bash
MACHINE_ID=$(hostname)
SKILL_NAME=<skill-name>
SKILL_DIR="skills/agent/machines/$MACHINE_ID/$SKILL_NAME"
mkdir -p "$SKILL_DIR/layers"

cp skills/agent/scaffolding/skill-template.md "$SKILL_DIR/SKILL.md"
cp skills/agent/scaffolding/layer-template.md "$SKILL_DIR/layers/core.md"
cp skills/agent/scaffolding/layer-template.md "$SKILL_DIR/layers/conventions.md"
cp skills/agent/scaffolding/layer-template.md "$SKILL_DIR/layers/gotchas.md"

# Then replace placeholders in all four files before committing.
```

Minimum contents after placeholder replacement:

```markdown
---
name: <skill-name>
description: Use when working with <technology/domain> on <hostname>.
---

# <Skill Name>

Use this skill when <specific trigger>.

## Purpose

<What this domain skill helps the agent do.>

## Layers

| Layer | File | Load When |
| --- | --- | --- |
| Core | `layers/core.md` | Always when this skill is selected |
| Conventions | `layers/conventions.md` | When implementing or reviewing domain-specific work |
| Gotchas | `layers/gotchas.md` | When debugging incidents or touching fragile paths |
```

### 4c — Wire domain skills into persona.md

In `persona.md`, under each `### <repo-name>` block, set the `skills:` field to the relevant domain skills:

```
### platform
- **path**: /path/to/platform
- **skills**: golang-development, kubernetes-specialist
- **repo-skill**: agent/machines/<hostname>/repos/platform
```

When an agent identifies a target repo, it loads the listed domain skills alongside the repo skill.

---

## Result

After this phase:
- `skills/agent/machines/<hostname>/persona.md` is complete with real values
- Each repo has a layered skill directory documenting invariants, conventions, and gotchas
- Domain skills for the team's stack are identified, referenced, and layered
- The agent can load the full context layer when starting work in any listed repo

**Next phase:** `onboard/3-people` — enrich person skills from GitHub, Slack, and Linear evidence.
