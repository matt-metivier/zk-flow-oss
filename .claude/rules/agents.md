---
path: .claude/agents/**/*.md
---
Agent definition files. Every agent must have:
1. Frontmatter: name, description, model, tools
2. Output budget line (≤150 char findings, ≤1500 token prose)
3. Output contract section with required schema fields
4. What NOT to do section

Writer agents (scope-locked-editor, pr-author) have `isolation: worktree` — each runs in its own git worktree so parallel edits don't conflict.

After editing agents: copy to ~/.claude/agents/ for global availability.
