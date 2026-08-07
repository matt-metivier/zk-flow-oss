# zk-flow domain glossary

Terms used across workflows, rubrics, and agent prompts. Grill/devils-advocate
cross-reference claims against this glossary.

## Research->design seam (Factory.ai Missions + deep-research lifts)

- **validation contract** — a finite checklist of testable behavioral assertions
  (`VAL-XXX-001` ids) defining done/correct, written at the research->design seam
  BEFORE the design defines its approach, so success criteria are not biased by the
  planned implementation (Factory.ai two-level TDD). Schema: `schemas/validation-contract.json`.
  Injected into the designer prompt via `ctx.contract` in `loadPhasePrompt`.

- **claim-verification gate** — abstention-aware adversarial quorum run after research
  and before research_complete. Each key finding is voted on by N skeptic voters
  (`verifyVotes`, default 2); killed claims are stripped from `key_findings` so they
  never reach design. Fragment: `src/fragments/claim-verify.js`.

- **voter** — a `critic` agent running the `claim-vote` schema for ONE finding.
  Emits `{claim_id, verdict: REFUTE|CONFIRM|ABSTAIN, confidence, rationale}`. Default
  to REFUTE when uncertain. Schema: `schemas/claim-vote.json`.

- **survives predicate** — `claimSurvives(votes, refuteThreshold)`: a claim survives
  ONLY if valid (non-abstaining) votes >= `refuteThreshold` AND refutes < `refuteThreshold`.
  All-ABSTAIN (or no-vote) fails — abstentions cannot keep a claim alive.

- **FixTask** — a TYPED COMMENT on the parent bead (bd has NO child-issue concept)
  emitted by `routeFindingsToBead` when a grader/arbiter returns non-APPROVE. Tagged
  `owner: scope-locked-editor` with a `phase:iteration` dedupe key. Implements
  validators-never-fix: a reviewing agent surfaces issues, never edits.

- **validators-never-fix** — Factory.ai Missions principle: the agent that judges work
  never fixes it (self-evaluation bias). Findings route back as FixTasks for a fresh
  writer iteration. Enforced at the tool layer too: `grader` has read-only `gh` verbs only.

- **graceful salvage** — `salvagePhase(out, phase)`: a null/undefined phase output
  becomes `{skipped:true}` instead of throwing, so one dead agent does not lose a whole
  run. Only null/undefined is softened; a non-null non-object still throws in
  `assertPhaseOutput`. Non-load-bearing writes use `persistPhaseSoft` (never aborts a run).

- **scope-locked-editor** — the only writer agent; edits constrained to the design's
  `affirmed_files`. Runs in an isolated git worktree (`isolation: worktree`).

## Control keys (args)

- `verifyVotes` — voters per claim in the verification gate (default 2).
- `maxClaims` — cap on findings verified per run (default 10), ranked by evidence_quality.
- `refuteThreshold` — REFUTE votes needed to kill a claim AND quorum of valid votes
  needed to adjudicate (default 2).

## /update workflow terms

- **soft-fail** — a per-source GATHER result where `ok: false` and `source_status: 'unavailable'`
  is returned instead of aborting the workflow. Allows DIFF and WRITE to proceed as long as at
  least one source succeeded. Total-soft-fail (all sources unavailable) returns `verdict:
  'update_skipped'` rather than a misleading `update_complete`.

- **persona-drift flag** — `persona_drift: boolean` in the WRITE phase result. Set `true` when
  live signals from GATHER/DIFF contradict the machine persona files
  (`skills/agent/machines/<host>/persona.md`, `datacenters.md`, `people/*.md`). The flag surfaces
  for operator review; the /update workflow never rewrites persona files autonomously.

- **vault-note refresh** — `notes_to_refresh[]` in the WRITE result: a list of vault note paths
  and reasons where DIFF detected stale content. The operator decides whether to update these
  files. The /update workflow never overwrites vault notes directly.

- **read-mostly workflow** — a workflow that reads from multiple live sources and durable stores,
  then writes only narrow bounded side-effects (capped `bd remember` calls). Heavy reads, minimal
  writes. Contrast with write-heavy workflows (e.g., /feature, /debug) that produce code and PRs.
  The /update workflow is the canonical read-mostly example in zk-flow.

## Knowledge sync (repo -> vault, chat -> memories)

- **skill drift** — a place where a repo skill contradicts the repo's actual code, found by
  `/vault-sync` comparing the scanned history against `$ZK_ARTIFACTS_DIR/skills/.../repos/<repo>/`.
  Emitted as `skill_drift[]` with `{skill_id, item, evidence}`; /vault-sync is forbidden from
  editing skills, so `/improve` consumes these (tagged `source: 'vault_sync_drift'`) and counts
  them toward its feedback threshold. A drift item is the cheapest input /improve can get: the
  skill is already named and the evidence already gathered.
- **sync marker** — the bd memory `vault-sync-marker-<repo>` holding the SHA a repo was last
  synced to. Derived in JS from the `repo=` argument, never from agent output, so a scan result
  cannot retarget another memory key. Its presence is what makes a run incremental rather than a
  re-scan.
- **gap evidence** — the searches that came back empty, required on any `action: 'create'` in a
  /vault-sync plan. Update-by-default is the rule; a create without gap_evidence is dropped by
  the workflow, because "I didn't find an existing note" is an assumption and is how a vault grows
  a second note about the same subsystem.
- **untrusted-data fence** — the `UNTRUSTED_EXTERNAL_DATA` markers wrapped around any payload the
  workflow did not author (chat messages, Jira summaries, commit messages, MR titles) before it
  reaches a phase that plans or writes. `src/fragments/knowledge-sync.js`.

## Scope and guardrails

- **scope gate** — after impl, `scopeViolations(files_changed, design.affirmed_files)` compares
  what changed against the design contract plus the always-allowed dirs (`tests/`, `docs/`,
  `CHANGELOG.md`). Violations route to handoff with `reason: 'scope_exceeded'` rather than
  throwing, because the work has already happened by then. An EMPTY affirmed_files means no
  opinion, not "everything is a violation" — `profile=small` has no design phase.
- **native skill discovery** — Claude Code discovers skills one level deep
  (`~/.claude/skills/<name>/SKILL.md`). The zk-artifacts tree nests up to five, so
  `scripts/install-skills.sh` flattens the catalog into `zk-<name>` symlinks. Two separate paths
  reach an agent: workflow prompt rendering (`renderSkills` / `selectAndRenderSkills`) and this
  flattening for interactive sessions.

- **context pack** — the machine persona + prior beads + vault MOC block produced by one
  fast-tier `contextPack()` call for workflows with no discover phase. Budget-clamped per
  section (`CONTEXT_BUDGETS`), injected via `ctx.context` in `loadPhasePrompt`. Prior beads
  are labelled precedent-to-check rather than fact at the injection point.
- **bounded bead retrieval** — `bdBoundedContext(keyword)`: N same-subject beads by recency
  plus M cross-subject recent ones, instead of grepping the whole board. Grep returns
  whatever shares a word; an unrelated bead injected as context is read as precedent.

