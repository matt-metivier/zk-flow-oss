---
path: .claude/agents/**/*.md
---
Agent definition files. Every agent must have:
1. Frontmatter: name, description, model, tools
2. Output budget line, in the agent's OWN output shape. The review perspectives share the
   canonical form (`findings[].why_it_matters` ≤150 chars, `summary` ≤200, prose ≤1500
   tokens); a schema-emitting agent budgets its own fields instead (e.g. test-runner
   budgets pass/fail counts + the shortest failing line, never the full log). Copy-pasting
   the findings-shaped line into an agent with no findings[] is worse than none.
   Exempt: `persist` (bash-only, emits no prose) and the GoalBuddy `goal-*` agents, which
   carry GoalBuddy's own "Hard contract" section instead of this repo's.
3. Output contract section with required schema fields
4. What NOT to do section

Writer agents (scope-locked-editor, pr-author) have `isolation: worktree` — each runs in its own git worktree so parallel edits don't conflict.

After editing agents: copy to ~/.claude/agents/ for global availability.
