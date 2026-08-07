Run the refactor workflow: `.claude/workflows/refactor.js`

Arguments: $ARGUMENTS

Refactor lifecycle: discover -> research -> refactor -> test. Restructures code WITHOUT changing observable behavior or public contracts.

**Phases:** Discover -> Research -> Refactor -> Test

**Args:**
- `bead=<id>` -- bead ID to correlate runs
- `brief=<text>` -- refactor target description to inject at start
- `targetEnv=<env>` -- test environment for the Test phase (default: local)
- `model=<tier|id>` -- global model override (fast/mid/deep or raw model id)
- `models=<phase:tier,...>` -- per-phase tier overrides, e.g. `models=research:deep,impl:fast`

**Example:** `/refactor brief=Extract authentication logic from UserController into AuthService`
