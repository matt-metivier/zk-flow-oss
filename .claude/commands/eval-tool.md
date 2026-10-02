Run the eval-tool workflow: `.claude/workflows/eval-tool.js`

Arguments: $ARGUMENTS

Evaluate external tools/repos for the zk stack — adopt / inspire / reject. Intake a repo, apply the tooling-eval rubric (license -> overlap -> liftable -> integration fit), write a verdict to the EVALS.md catalog, and emit a lift command at a seam. Never auto-merges or auto-chains.

**Phases:** Intake -> Assess -> Verdict -> Catalog -> LiftRoute

**Args:**
- `<repo-url> [<repo-url> ...]` -- one or more repos to evaluate (positional)
- `model=<tier|id>` -- global model override

Requires `ZK_ARTIFACTS_DIR` (catalog lives at `$ZK_ARTIFACTS_DIR/skills/general/tools/tooling-eval/EVALS.md`) and an initialized `bd`.

**Example:** `/eval-tool https://github.com/obra/superpowers https://github.com/langgenius/dify`
