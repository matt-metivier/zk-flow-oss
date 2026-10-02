---
name: onboard-1-machine
description: Machine infrastructure phase -- hostname identity, repo clone, env var setup, and CLI verification. Run this first when adding any new machine to work with zk-flow and zk-artifacts.
---

# Phase 1 — Machine

Set up the machine to run zk-flow and zk-artifacts: hostname identity, clone repos, set `ZK_ARTIFACTS_DIR`, verify the `claude` CLI and `bd` CLI.

**Architecture:** zk-flow is local-only -- CC workflows run as direct Claude Code sessions. No NATS, no Docker spawner, no Tailscale.

> **Scope split:** the [zk-flow README](https://github.com/matt-metivier/zk-flow#setup) covers single-machine install (clone, `npm install`, `bd init`, symlinks, `/health`). Do that first. These 5 onboard phases then add the layer the README does not: machine identity, persona, people skills, tribal knowledge, and the Claude Code hygiene layer.

---

## Prerequisites

| Tool | Install | Required |
|------|---------|----------|
| `claude` CLI | Claude Code Max subscription | **Yes** |
| `git` | `brew install git` (macOS) | **Yes** |
| `gh` CLI | `brew install gh` | **Yes** |
| `node` + `npm` | `brew install node` | **Yes** (zk-flow build/tests) |
| `jq` | `brew install jq` | **Yes** (bd recipes + `/health`) |
| `uv` | `curl -LsSf https://astral.sh/uv/install.sh | sh` | Optional (was for CodeGraphContext; replaced by codebase-memory-mcp, needs no uv) |

---

## Step 1 — Set the machine hostname

Pick a short, unique name. This becomes your machine identity across skill paths and config.

```bash
# macOS
sudo scutil --set HostName <chosen-name>
sudo scutil --set LocalHostName <chosen-name>
sudo scutil --set ComputerName <chosen-name>

# Linux
sudo hostnamectl set-hostname <chosen-name>
```

```powershell
# Windows (PowerShell, admin)
Rename-Computer -NewName <chosen-name> -Force
# Reboot required
```

Verify:

```bash
hostname
```

Expected output: `<chosen-name>`.

---

## Step 2 -- Clone Repos (If Not Already Present)

```bash
# Workflow engine
git clone git@github.com:matt-metivier/zk-flow.git ~/dev/zk-flow

# Artifacts (private -- skills, vault)
git clone git@github.com:matt-metivier/zk-artifacts.git ~/dev/zk-artifacts

```

Or pull if already cloned:

```bash
cd ~/dev/zk-flow && git pull
cd ~/dev/zk-artifacts && git pull
```

Set the env var (add to shell profile):

```bash
export ZK_ARTIFACTS_DIR=~/dev/zk-artifacts
```
```

---

## Step 3 — Create Machine Skills Directory

```bash
MACHINE_ID=$(hostname)
mkdir -p "skills/agent/machines/$MACHINE_ID/repos"
echo "Created: skills/agent/machines/$MACHINE_ID/"
```

---

## Step 4 — Create persona.md

This is the single source of truth for the machine — identity, connectivity, people skills to load, and repo-to-skill mappings.

```bash
cat > "skills/agent/machines/$MACHINE_ID/persona.md" << 'EOF'
---
name: <alias>-persona
description: Machine identity, connectivity, people, and repo-skill mappings for <alias>.
---

# <alias>

- **Alias**: <alias>
- **Hostname**: <hostname>
- **Owner**: <name> (@github-handle)
- **Team**: <team name>

## Connectivity

| Service | Address | Auth |
|---------|---------|------|
| GitHub | github.com | gh CLI (OAuth) |

## Repos

### <repo-name>
- **path**: /absolute/path/to/repo
- **skills**: <global-skill>, <global-skill>
- **repo-skill**: agent/machines/<alias>/repos/<repo-name>

EOF
```

**Fill in placeholders** with real values. See `skills/agent/machines/sb/persona.md` for a complete example.

---

## Step 4b — Wire persona auto-load

Creating `persona.md` is not enough — zk-flow only loads it automatically once it can
resolve this machine's **alias**. The `SessionStart` hook (`scripts/load-persona.sh`)
checks `bd config get host` first, then falls back to `$ZK_HOST_ALIAS`. Set one:

```bash
# Preferred: persist the alias in beads config
cd "$ZK_FLOW_DIR" && bd config set host <alias>

# Or export it (also read as a fallback by the persona hook)
echo 'export ZK_HOST_ALIAS=<alias>' >> ~/.zshenv && source ~/.zshenv
```

The hook then emits `skills/agent/machines/<alias>/persona.md` as session context on every
new Claude Code session, so the main session has machine identity immediately (not just the
discover phase). Verify it fires:

```bash
bash "$ZK_FLOW_DIR/scripts/load-persona.sh" | head -3
# -> "## Machine persona (host: <alias>) — auto-loaded by zk-flow SessionStart hook"
```

Prints nothing? The alias is unset (above) or the persona file is missing (Step 4).
`/health` check 13 and `/onboard` Phase 4 both verify this wiring — run either to confirm.

---

## Step 5 -- Verify CLIs

Confirm the required CLIs are working:

```bash
# Claude Code CLI
claude --version

# bd CLI (bead state)
bd --version

# gh CLI
gh auth status
```

All three must succeed before proceeding to Phase 2.

---

## Step 5b -- Configure beads

Beads database lives in `~/dev/zk-flow/.beads/`. Set `BEADS_DIR` so `bd` resolves it from any directory, and set `beads.role` globally so `bd ready` runs without warnings.

```bash
# Persist BEADS_DIR (non-interactive shells + Claude Code hooks)
echo 'export BEADS_DIR=~/dev/zk-flow/.beads' >> ~/.zshenv

# Set role globally (avoids "beads.role not configured" warning on every bd call)
git config --global beads.role maintainer

# Reload and verify
source ~/.zshenv
bd ready   # should show issues or "No open issues" with no warnings
```























---

## Step 6 -- Final verification

### Verification checklist

- [ ] `hostname` returns `<alias>`
- [ ] `claude --version` succeeds
- [ ] `bd --version` succeeds
- [ ] `gh auth status` authenticated
- [ ] `echo $ZK_ARTIFACTS_DIR` returns `~/dev/zk-artifacts` (or absolute path)
- [ ] `echo $BEADS_DIR` returns `~/dev/zk-flow/.beads` (or absolute path)
- [ ] `git config --global beads.role` returns `maintainer`
- [ ] `bd ready` exits 0 with no warnings
- [ ] `skills/agent/machines/<alias>/persona.md` exists with real values
- [ ] `bd config get host` returns `<alias>` (or `$ZK_HOST_ALIAS` is exported)
- [ ] `bash $ZK_FLOW_DIR/scripts/load-persona.sh` prints the machine persona
- [ ] `~/dev/zk-flow` and `~/dev/zk-artifacts` are cloned and up to date

All checks must pass before proceeding to Phase 2.

---











## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `claude --version` fails | Install Claude Code Max and run `claude --version` to verify |
| `bd --version` fails | Install bd CLI; check PATH |
| `gh auth status` fails | `gh auth login` |
| `ZK_ARTIFACTS_DIR` not set | Add `export ZK_ARTIFACTS_DIR=~/dev/zk-artifacts` to shell profile and reload |

---

## Running Workflows

Open a Claude Code session in `~/dev/zk-flow` and invoke a slash command:

```bash
cd ~/dev/zk-flow
claude
# then inside the session:
# /mol-feature
# /review-council
# etc.
```

See the [zk-flow README](https://github.com/matt-metivier/zk-flow) for the full workflow catalog.
