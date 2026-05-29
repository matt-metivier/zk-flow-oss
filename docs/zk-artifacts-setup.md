# Setting up your zk-artifacts repo

zk-flow workflows are content-free by design. Domain knowledge, solution writeups, and
operator personas live in a separate **private** repo called `zk-artifacts` (or any name
you choose). zk-flow loads from it by path via the `$ZK_ARTIFACTS_DIR` environment variable.

This separation keeps zk-flow safe to publish while your real content stays private.

---

## What zk-artifacts contains

```
zk-artifacts/
  skills/                       domain how-to loaded by agents
    <area>/<topic>/<name>/
      SKILL.md                  frontmatter + prose instructions
  vault/                        prose knowledge base
    <topic>/                    solution writeups, notes, ADRs
  skills/agent/machines/
    <alias>/
      persona.md                operator/machine identity (who "you" are in this context)
  credentials/                  optional; gitignore this subtree
```

**skills/** -- Agents load skills by path when the `discover` phase selects them. Skills
are domain how-to documents (e.g. "how to write a good PR description", "how to review
security posture for this stack"). They are shared across machines via git.

**vault/** -- Prose knowledge read by `researcher` and `prior-art` agents, and written to
by `solution-extractor`/`vault-writer` agents after successful runs. Accumulates
institutional knowledge over time.

**skills/agent/machines/<alias>/persona.md** -- Defines the operator identity: who the
agent thinks it is working for, what machine/context it is running in, and any
machine-specific conventions. Optional but useful when running zk-flow on multiple machines.

---

## Setup steps

**1. Create the repo**

```bash
mkdir -p ~/dev/zk-artifacts
cd ~/dev/zk-artifacts
git init
```

**2. Export environment variables**

Add to your shell profile (`~/.zshrc`, `~/.bashrc`, etc.):

```bash
export ZK_ARTIFACTS_DIR=~/dev/zk-artifacts
export ZK_VAULT_DIR=$ZK_ARTIFACTS_DIR/vault
```

Reload: `source ~/.zshrc` (or open a new terminal).

**3. Scaffold the directory structure**

```bash
mkdir -p $ZK_ARTIFACTS_DIR/skills
mkdir -p $ZK_ARTIFACTS_DIR/vault
mkdir -p $ZK_ARTIFACTS_DIR/skills/agent/machines
```

**4. Gitignore sensitive content** (if using credentials)

```bash
echo 'credentials/' >> $ZK_ARTIFACTS_DIR/.gitignore
```

**5. Optional: create a persona**

```bash
mkdir -p $ZK_ARTIFACTS_DIR/skills/agent/machines/myalias
cat > $ZK_ARTIFACTS_DIR/skills/agent/machines/myalias/persona.md << 'EOF'
---
name: myalias
description: Operator identity for <your name> on <machine name>
---
You are working for <your name>. This machine is <machine name>. <Any relevant context.>
EOF
```

---

## Skill frontmatter template

Every skill file must have YAML frontmatter followed by the how-to prose:

```markdown
---
name: my-skill-name
description: One sentence: what this skill teaches the agent.
depends_on: []
---

# My Skill

[Prose instructions here. Write as if explaining to a capable engineer who
has no domain context. Agents load this verbatim into their prompt.]

## When to apply

...

## Steps / rules

...
```

**Fields:**
- `name` -- machine-readable identifier (kebab-case)
- `description` -- shown in skill listings; used by the discover agent when selecting skills
- `depends_on` -- list of other skill names this one assumes; currently informational

**Example path:**

```
$ZK_ARTIFACTS_DIR/skills/general/practices/handoff/SKILL.md
$ZK_ARTIFACTS_DIR/skills/backend/api/rate-limiting/SKILL.md
$ZK_ARTIFACTS_DIR/skills/frontend/react/component-patterns/SKILL.md
```

---

## Graceful degradation

If `$ZK_ARTIFACTS_DIR` is unset, zk-flow agents skip skill and vault lookups and run on
their built-in prompts. All workflows remain functional; they just have no domain-specific
how-to injected. You can start using zk-flow before setting up zk-artifacts and add the
companion repo later.

---

## Keep it private

zk-artifacts holds your personal and work content. Keep the repo private (or local-only).
zk-flow itself is public and contains no secrets or work content.
