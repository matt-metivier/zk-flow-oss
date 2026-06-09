Run a zk-flow setup health check.

Arguments: $ARGUMENTS

Checks all required pieces are in place before running workflows.

**Checks:**

1. `ZK_ARTIFACTS_DIR` set + directory exists
2. `ZK_VAULT_DIR` set + directory exists
3. bd initialized (`bd ready` exits 0)
4. `npm run build` produces 13 workflow files
5. `~/.claude/workflows/` symlink intact
6. `~/.claude/agents/` contains zk-flow agents

**Run:**
```bash
# Quick manual check
echo "ZK_ARTIFACTS_DIR=$ZK_ARTIFACTS_DIR" && \
echo "ZK_VAULT_DIR=$ZK_VAULT_DIR" && \
bd ready 2>&1 | head -3 && \
ls ~/.claude/workflows/*.js | wc -l && \
ls ~/.claude/agents/ | wc -l
```

Emit a pass/fail summary per check. If any fail, output the exact fix command.
