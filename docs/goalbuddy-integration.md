# GoalBuddy <-> zk-flow integration (Option A bridge)

This is the **Option-A bridge**: a GoalBuddy `goal_worker` task drives a zk-flow
CORE workflow **non-interactively** (via `claude -p`) and harvests the run's
`ProofOfWork` bead as its receipt. The bridge is one small CLI
(`scripts/goalbuddy-zkflow-run.{sh,mjs}`) plus the existing bead memory layer —
no changes to the workflows themselves.

```
GoalBuddy task ──▶ goalbuddy-zkflow-run ──▶ claude -p "/<workflow> ..."
                                                     │
                                          (run writes phase comments to a bead)
                                                     ▼
                  goalbuddy_receipt_v1 ◀── bd comments <bead> ──▶ ProofOfWork: {...}
```

## The seam

zk-flow workflows are slash-commands that Claude Code runs in **print /
non-interactive** mode. The installed `claude` CLI exposes `-p/--print` for this;
it has **no** `--headless` and **no** `--max-turns` flag (an earlier version of
this bridge built those and errored `unknown option '--headless'`). The shape is:

```bash
# supervised (default): file edits auto-accept, run stays in acceptEdits posture
claude -p --permission-mode acceptEdits "/feature autoApprove=true bead=<id> brief=<text>"

# unattended (--auto): writes never block on a permission prompt
claude -p --dangerously-skip-permissions "/feature autoApprove=true bead=<id> brief=<text>"
```

This bridge is the **single-task** analogue of `scripts/zkflow-daemon.sh`:
GoalBuddy hands it one workflow + one input, it runs exactly that, and returns a
structured receipt instead of dispatching a whole board.

### Headless slash execution: the slash command MUST be at prompt position 0

`claude -p` only **auto-executes** a zk-flow workflow when the slash command is
the **first characters** of the prompt. Empirically (probes against `/health` in
a zk-flow checkout):

| Prompt passed to `claude -p --dangerously-skip-permissions` | Result |
|---|---|
| `"/health"` | workflow EXECUTES to completion |
| `"/health (run now, non-interactively, to completion; do not ask)"` | workflow EXECUTES (slash still first) |
| `"Run the following workflow now: /health"` | DEGRADES — print mode treats it as a conversational prompt that merely *mentions* a command; it defers or does a tangential action |

So the bridge **never** prepends natural-language text before the slash command.
It builds the prompt as `"/<workflow> ... (run now, non-interactively, to a
terminal verdict; do not ask for confirmation)"` — the **trailing** directive
(`withNonInteractiveDirective`) hardens against a nested session inheriting an
orchestrator's "ask before proceeding" posture, while keeping the slash at
position 0 so it still auto-executes.

This corrects an earlier hypothesis: a live `--auto` run against
`<org>/<repo>` printed *"Stopped. Awaiting your call on how to proceed."*
That was **not** a print-mode slash problem. It was the **bd failure cascade**
below: `/finish-pr` has a hard bd dependency, the target's `.beads` DB was not
materialized, every `bd` call errored `no beads database found`, and the workflow
deferred rather than fabricating a verdict. Fixing the bd sandbox (below)
resolves the stop; the invocation shape was already correct.

## Permission mode (`--auto`)

Non-interactive zk-flow runs WRITE files. With no permission control `claude -p`
would block on an interactive permission prompt that never gets answered, so the
bridge always sets one of two postures:

| Invocation | Flag emitted | When |
|---|---|---|
| default | `--permission-mode acceptEdits` | supervised; file edits auto-accept |
| `--auto` | `--dangerously-skip-permissions` | unattended GoalBuddy runs; bypass all permission checks so writes do not block |

Unattended GoalBuddy/daemon runs MUST pass `--auto` — the supervised
`acceptEdits` mode can still stall on non-edit permission requests. The
`--dangerously-skip-permissions` flag is the documented way to run fully
unattended.

The bridge never merges. zk-flow workflows stop at a handoff/testing boundary;
landing code is a human (or PM) decision.

## Workflow selection (mapping)

`selectWorkflow()` mirrors the daemon's `plan_dispatch` heuristic:

| Input | Workflow | Why |
|---|---|---|
| `workflow=<feature\|small-feature\|debug\|finish-pr>` | that one | explicit override wins |
| `pr=<url\|num>` | `finish-pr` | a PR exists → finalize it (remote CI) |
| bug-shaped `brief=`/`bead=` (`fix`, `bug`, `broken`, `regression`, `fails`, ...) | `debug` | defect-shaped work |
| anything else | `feature` | new capability |

## The autoApprove requirement

`/feature` chains **design → impl** across a handoff seam that, by default,
**stops for human approval** (returns `verdict: design_complete`). For an
unattended GoalBuddy run that seam must not block, so the bridge **always**
appends `autoApprove=true` to `/feature` — this is the control key that makes
RUN 1's approved design fall through into RUN 2 (impl) in the same invocation
(see `tests/feature-autoapprove.test.js` and `src/fragments/args.js` CONTROL_KEYS).

`/small-feature`, `/debug` and `/finish-pr` have **no design seam** — they run to a terminal
verdict in a single invocation — so the bridge does **not** add `autoApprove` to
them.

## `max_turns` is deprecated (accepted-but-ignored)

The installed `claude` CLI has **no `--max-turns` flag**, so the bridge emits
nothing for it. A `max_turns=<n>` token is still **accepted** on the CLI for
backward compatibility but is **ignored** — it does not appear in the built
command. Turn budgeting is left to the model/CLI defaults.

## The bead <-> receipt mapping

Every phase persists a typed comment to the run bead (`<Type>: <json>`, see
`docs/beads.md` and `src/fragments/bd-memory.js`). On successful completion the
workflow writes one `ProofOfWork` comment (`src/fragments/bead-run.js`
`buildProofOfWork`):

```
ProofOfWork: {"bead","branch","verdict","route","files_changed","commits","review","tests"}
```

The bridge reads it with `bd comments <bead>`, takes the **last** `ProofOfWork:`
line (a re-run appends a fresh one), JSON-parses it, and maps:

| ProofOfWork field | goalbuddy_receipt_v1 field | Notes |
|---|---|---|
| `verdict` | `verdict` + `result` | `result = done` iff `verdict == APPROVE`, else `blocked` |
| `files_changed` | `changed_files` | [] if absent |
| `commits` | `commits` | [] if absent |
| `tests` | `tests` | `{passed, failed}` or null |
| `bead`, `branch`, `review`, `route` | folded into `summary` | one-line acceptance line |

If no `ProofOfWork` is found (run truncated / failed before completion) the
receipt is `result: blocked` with empty `changed_files`/`commits`.

## Fail-safe behavior

When **executing** (not `--dry-run`), the bridge refuses to run and emits a
clear error (exit 2) if:

- `ZK_ARTIFACTS_DIR` is unset (zk-flow needs it for skills/vault).
- No run bead can be resolved to harvest `ProofOfWork` from — pass `bead=<id>`.
  (finish-pr derives `zk-flow-pr-<slug>` and brief-only runs slug their own id;
  supply the bead explicitly so the bridge reads the right one.)
- `bd comments <bead>` fails (bd missing or the bead absent).
- `node` is not on PATH (shell wrapper).

`--dry-run` and `--help` perform **none** of these checks — they exit 0 and just
print (the command they would run / usage).

## Usage

```bash
# Dry-run: print the claude command, run nothing (exit 0)
scripts/goalbuddy-zkflow-run.sh --dry-run workflow=feature brief="add rate limiting"
#   -> claude -p --permission-mode acceptEdits "/feature autoApprove=true brief=\"add rate limiting\""

# Same, unattended: --auto emits --dangerously-skip-permissions
scripts/goalbuddy-zkflow-run.sh --dry-run --auto workflow=feature brief="add rate limiting"
#   -> claude -p --dangerously-skip-permissions "/feature autoApprove=true brief=\"add rate limiting\""

# Feature, correlated to a bead so we can read ProofOfWork back (unattended)
scripts/goalbuddy-zkflow-run.sh --auto workflow=feature bead=zk-flow-rate-limit brief="add rate limiting" task_id=T042

# Bugfix (no autoApprove)
scripts/goalbuddy-zkflow-run.sh --auto workflow=debug bead=zk-flow-login-bug brief="login fails on Safari"

# Finish a PR (pass bead= so the receipt can be harvested)
scripts/goalbuddy-zkflow-run.sh --auto workflow=finish-pr pr=https://github.com/o/r/pull/7 bead=zk-flow-pr-7
```

On completion it prints a `goalbuddy_receipt_v1` JSON to stdout and exits 0 on a
`done` receipt, 1 on `blocked`, 2 on a precondition/IO error:

```json
{
  "goalbuddy_receipt_v1": {
    "result": "done",
    "task_id": "T042",
    "changed_files": ["src/limiter.js"],
    "commits": ["abc123"],
    "verdict": "APPROVE",
    "tests": { "passed": 12, "failed": 0 },
    "summary": "feature run on bead zk-flow-rate-limit -> APPROVE (branch zkflow/zk-flow-rate-limit, 1 file(s), 1 commit(s), review APPROVE)"
  }
}
```

## Provisioning a target repo (`--provision`)

zk-flow slash-workflows (`/finish-pr`, `/feature`, ...) **only exist** when the
cwd has `.claude/workflows/*.js` + `.claude/agents/*.md`, and `/finish-pr`
resolves the target repo from the cwd's `git remote`. An arbitrary target repo
(e.g. `/Users/me/dev/minions`) has none of these. The bridge **transiently
provisions** the target so a workflow can run there, then **cleans up** to leave
the repo exactly as it found it.

| Flag | Default | Meaning |
|---|---|---|
| `--provision` | **ON** | install zk-flow's `.claude/workflows` + `.claude/agents` into the target cwd if it lacks `.claude/workflows` |
| `--no-provision` | — | install nothing; assume the target already has `.claude/workflows` |
| `--cleanup` | **ON after a real run** | remove ONLY what provisioning added, restoring the target as found |
| `--no-cleanup` | — | leave the provisioned files in place after the run |

When provisioning is needed (cwd lacks `.claude/workflows`), the bridge:

1. Resolves zk-flow's own repo root from the script location
   (`scripts/goalbuddy-zkflow-run.mjs` is one level under the repo root, via
   `import.meta.url`).
2. **Appends the provisioned paths to `<cwd>/.git/info/exclude` BEFORE copying**
   — a local, uncommitted ignore. It does **NOT** touch the target's tracked
   `.gitignore`. The exclude lines are `/.claude/workflows/` and
   `/.claude/agents/`.
3. Copies `.claude/workflows/` + `.claude/agents/` from zk-flow into
   `<cwd>/.claude/`.
4. Probes whether **bd is operational** in the target (see below). If it is NOT,
   it spins up a **local-only temp sandbox bd** — never touching the target's
   `.beads`.
5. Records exactly what it created so `--cleanup` reverses **only** that (never a
   pre-existing target file: a `.claude` dir / exclude line that was already
   there is left untouched), plus the temp sandbox dir.

### bd-readiness detection (NOT "is there a `.beads` dir?")

A `.beads` dir existing does **not** mean bd works. `<org>/<repo>` ships
a `.beads` dir whose dolt DB was never materialized: every `bd` command errors
`no beads database found`, so `/finish-pr` (hard bd dependency) cannot persist
its run bead and stops without a verdict. The bridge therefore probes bd's
**operational state**, not directory presence:

- It runs `bd where` in the target cwd and inspects the **output** (bd exits 0
  even when no DB resolves, so the exit code is useless). `bd` prints
  `no beads database found` / `No active beads workspace found` /
  `run 'bd init'` when nothing resolves (`bdProbeSaysNotOperational`).
- **bd operational** → the run uses the target's own bd unchanged; no init, no
  `BEADS_DIR` override.
- **bd NOT operational** (broken / unmaterialized / absent) → the bridge bypasses
  the target's bd entirely and uses a **local-only sandbox** (below).

This decision is independent of dir provisioning: a target can have
`.claude/workflows` already (so dirs are a no-op) but a broken bd, in which case
the sandbox still kicks in (even under `--no-provision`).

### LOCAL-ONLY sandbox beads (no push, target `.beads` untouched)

When bd is not operational, the bridge initializes a sandbox under the **OS temp
dir** (`os.tmpdir()/gb-bridge-beads-<bead>/.beads`, via `sandboxBeadsDir`), keyed
by the run bead so concurrent runs do not collide. It is reached **only** through
`BEADS_DIR`, and that same `BEADS_DIR` is threaded into the env of **both** the
headless `claude` run **and** the `bd comments` harvest — so the workflow
persists its beads into the sandbox and the bridge reads the `ProofOfWork` back
from the same sandbox. The target git remote (e.g. `<org>/<repo>`)
therefore never receives `refs/dolt/data` or any bd sync. Guarantees:

- `bd init --prefix zk-flow --stealth --non-interactive`.
  - `--prefix zk-flow` is **required**: zk-flow's `runBeadId`
    (`src/fragments/bead-run.js`) derives every run bead as `zk-flow-<slug>` and
    the bd DB **enforces** that id prefix. Without it the sandbox would default
    its prefix to the temp-dir name (`gb-bridge-beads-*`), and the workflow's
    `zk-flow-*` writes/reads would fail with a prefix mismatch — the harvest
    would find no bead (observed on the first proof run before this fix).
  - `--stealth` wires per-repo `.git/info/exclude` + invisible usage; the
    embedded dolt engine has **no remote**, so it cannot auto-push.
- `bd config set backup.git-push false` (belt-and-suspenders).
- **Never** running `bd dolt push` and **never** adding a dolt remote.
- The temp sandbox dir is removed on `--cleanup` (the target's `.beads`, if any,
  is never touched).

With no dolt remote and auto-sync off, the target's git remote receives nothing
from beads. Manual sync remains opt-in and is not performed by this bridge.

### Dry-run shows the plan

`--dry-run` prints the provisioning **plan** (what it would copy, the exclude
lines, whether `bd init` would run, the local-only assertion) **and** the
`claude` command, exits 0, and performs **no** filesystem changes:

```bash
scripts/goalbuddy-zkflow-run.sh --dry-run --provision \
    workflow=finish-pr pr=40 bead=minions-pr40-finishpr cwd=/Users/me/dev/minions
```

```
provision plan (LOCAL-ONLY — nothing committed/pushed to the target remote):
  copy  /Users/me/dev/zk-flow/.claude/workflows  ->  /Users/me/dev/minions/.claude/workflows
  copy  /Users/me/dev/zk-flow/.claude/agents  ->  /Users/me/dev/minions/.claude/agents
  exclude /Users/me/dev/minions/.git/info/exclude += /.claude/workflows/ , /.claude/agents/
  bd: target bd NOT operational — sandbox at /var/folders/.../T/gb-bridge-beads-minions-pr40-finishpr/.beads
  bd init --prefix zk-flow --stealth --non-interactive   (BEADS_DIR=/var/folders/.../T/gb-bridge-beads-minions-pr40-finishpr/.beads)
  bd config set backup.git-push false   (no refs/dolt/data push)
  claude + harvest run with BEADS_DIR=/var/folders/.../T/gb-bridge-beads-minions-pr40-finishpr/.beads
  local-only: bridge never runs `bd dolt push` / adds a dolt remote
claude -p --permission-mode acceptEdits "/finish-pr pr=40 bead=minions-pr40-finishpr"
```

(If the target's bd is **operational**, the plan reports `bd is operational —
used as-is` and emits no `BEADS_DIR` override.)

### End-to-end example targeting minions

```bash
# Real run: provision minions, drive /finish-pr non-interactively (unattended),
# harvest ProofOfWork, then clean up minions back to as-found (provision +
# cleanup are both ON). --auto -> --dangerously-skip-permissions.
scripts/goalbuddy-zkflow-run.sh --auto --provision \
    workflow=finish-pr pr=40 bead=minions-pr40-finishpr \
    cwd=/Users/me/dev/minions task_id=T013
```

After the run, `minions` has no `.claude/workflows`, no `.claude/agents`, its
`.git/info/exclude` has the provisioned lines removed, the temp sandbox bd is
deleted — and the minions remote never received a bead push.

The provisioning logic is split into **pure plan functions**
(`computeProvisionPlan`, `computeCleanupPlan`, `formatProvisionPlan`) that compute
the plan without any FS ops, and FS orchestrators (`applyProvision`,
`cleanupProvision`) that are the only code touching disk/bd — both injectable for
tests.

## CLI options

| Key | Default | Meaning |
|---|---|---|
| `workflow=` | inferred | `feature` \| `small-feature` \| `debug` \| `finish-pr` |
| `bead=` / `brief=` / `pr=` | — | one required (bead also enables receipt harvest) |
| `max_turns=` | — | DEPRECATED, accepted-but-ignored (the claude CLI has no `--max-turns`) |
| `model=` | inherit | model override (all tiers are opus 4.8 now) |
| `cwd=` | current dir | repo to run in |
| `task_id=` | null | GoalBuddy task id, echoed into the receipt |
| `--auto` | — | unattended: pass `--dangerously-skip-permissions` (default is `--permission-mode acceptEdits`) |
| `--provision` / `--no-provision` | provision ON | transiently install zk-flow workflows into the target (LOCAL-ONLY) |
| `--cleanup` / `--no-cleanup` | cleanup ON after a real run | revert exactly what provisioning added |
| `--dry-run` | — | print the provisioning plan + command, exit 0, touch nothing |
| `--help`, `-h` | — | print usage, exit 0 |

## Testing

`tests/goalbuddy-zkflow-run.test.js` covers the pure logic (workflow selection,
autoApprove injection, command shape, ProofOfWork extraction, receipt mapping,
**bd-readiness detection**, the **temp sandbox plan** + `BEADS_DIR` threading,
and the **invocation-prompt shape** — slash stays at position 0) and drives
`runBridge` with injected `runHeadless`/`readBdComments`/`bdProbe` deps — **no
`claude` or live bd DB is ever invoked**. The shell wrapper's `--help`/`--dry-run`
exit-0 contract is smoke-tested too.

### Proven live (option-3 proof)

Against a throwaway local git repo with **no operational bd** (so the sandbox
path runs) and a trivial planted bug, an `--auto` `debug` run:

- detected bd as not operational, created the `--prefix zk-flow` temp sandbox,
  and threaded `BEADS_DIR` into the headless `claude` and the harvest;
- **executed the workflow headlessly** (Research → Impl → CI → Review phases ran;
  it did NOT "Stop. Awaiting your call");
- persisted typed phase comments into the sandbox bead `zk-flow-calc-add-bug`,
  which the bridge read back end-to-end (the prefix fix resolved the earlier
  `no issue found` harvest miss). The `ProofOfWork → goalbuddy_receipt_v1` mapping
  was verified on the live sandbox bead, yielding `result: done`.

(The small-feature workflow's own write-on-a-side-worktree-branch behavior is a separate
zk-flow concern; the bridge's bd-sandbox + harvest seam is what this proves.)
