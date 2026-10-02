# Onboarding a new machine to zk-flow

Step-by-step setup for a new machine. Work through the numbered guides in order:

1. [`1-machine.md`](1-machine.md) — clone the repos, set env vars, install `bd`, wire the beads DB
2. [`2-skills.md`](2-skills.md) — author/load skills (uses the scaffolding templates in zk-artifacts)
3. [`3-people.md`](3-people.md) — people/team context
4. [`4-tribal.md`](4-tribal.md) — tribal knowledge capture
5. [`5-claude-code-defaults.md`](5-claude-code-defaults.md) — Claude Code settings, hooks, MCP wiring
6. [`6-daily-digest.md`](6-daily-digest.md) — cross-machine end-of-day handoff

Templates: [`claude-global.md.template`](claude-global.md.template), [`claudeignore.template`](claudeignore.template). Helper: [`ast-only-build.py`](ast-only-build.py).

The fastest path on a configured machine is `/onboard` (idempotent auto-fix), then `/health` (fail-hard verify). These guides are the manual/reference version.

## Paths are flexible — nothing is hardcoded

Every path below is an **example using the conventional `~/dev` layout**. Nothing in zk-flow requires it. The system resolves locations from environment variables, so put the repos wherever you like and set:

| Var | Points at | Default if unset |
|---|---|---|
| `ZK_FLOW_DIR` | the zk-flow checkout | `$HOME/dev/zk-flow` |
| `ZK_ARTIFACTS_DIR` | the zk-artifacts checkout (skills, vault, personas) | `$HOME/dev/zk-artifacts` |
| `BEADS_DIR` | the beads DB (`<zk-flow>/.beads`) | resolved from cwd; **set it** so `bd` works from any directory |

Hooks and scripts all use `${ZK_FLOW_DIR:-$HOME/dev/zk-flow}`-style fallbacks, so they work whether or not you set the vars — but setting them lets you place the repos anywhere. When a guide writes `~/dev/zk-flow`, read it as "wherever `ZK_FLOW_DIR` points."

> **Personal data stays in zk-artifacts.** These onboarding *docs* live in zk-flow (the public-facing tooling repo). Your machine persona, repo skills, and vault live in `$ZK_ARTIFACTS_DIR/skills/agent/machines/<alias>/` and never move into zk-flow.
