// src/fragments/persona-load.js
// Builds the persona + repo-context load section for the discover phase prompt.
// Injected after research so the agent has full context when selecting skills.
// The agent executes these bash commands to load machine-specific context.

export function buildPersonaSection() {
  return `
## Load machine persona and repo context (REQUIRED before skill selection)

1. Get machine alias:
\`\`\`bash
ALIAS=$(bd config get host 2>/dev/null)
echo "alias=$ALIAS"
\`\`\`

2. Load persona (identity, repos on disk, networking, conventions):
\`\`\`bash
[ -n "$ALIAS" ] && [ -f "$ZK_ARTIFACTS_DIR/skills/agent/machines/$ALIAS/persona.md" ] && \
  cat "$ZK_ARTIFACTS_DIR/skills/agent/machines/$ALIAS/persona.md" && \
  cat "$ZK_ARTIFACTS_DIR/skills/agent/machines/$ALIAS/local-dev.md" 2>/dev/null || \
  echo "No persona found for alias=$ALIAS — continuing without machine context."
\`\`\`

3. Load repo-specific skill if it exists for the active repo:
\`\`\`bash
REPO=$(git remote get-url origin 2>/dev/null | sed 's|.*/||;s|\\.git$||' | tr '[:upper:]' '[:lower:]')
REPO_SKILL="$ZK_ARTIFACTS_DIR/skills/agent/machines/$ALIAS/repos/$REPO/SKILL.md"
[ -f "$REPO_SKILL" ] && cat "$REPO_SKILL" || \
  echo "No repo-specific skill found for repo=$REPO at $REPO_SKILL"
\`\`\`

4. List available machine skills to inform selection:
\`\`\`bash
ls "$ZK_ARTIFACTS_DIR/skills/agent/machines/$ALIAS/" 2>/dev/null
\`\`\`

Use the persona and repo skill content to inform your skill selection below.
`;
}
