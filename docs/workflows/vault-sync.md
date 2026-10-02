# vault-sync

Repo-driven vault note sync. Reads what actually merged on a repo's default branch since the last sync, maps the changed areas with codebase-memory-mcp, diffs that against the vault notes already covering the repo, then creates/updates those notes and advances a per-repo sync marker in bd.

## Relationship to `/update`

They are complements, not duplicates, and they share scaffolding rather than merging:
`src/fragments/knowledge-sync.js` holds the untrusted-data fence, the key sanitizer, and
the env+bd preflight both use.

**Why not one command:** `/update` ingests text an adversary can write (Slack, Telegram,
Jira) and never writes files; `/vault-sync` writes files. Merging them would put an
adversary-writable input on a file-writing path.

**The seam:** `/update` detects stale notes but cannot fix them, so it now emits
`suggested_commands[]` — the exact `/vault-sync repo=<x>` invocations for notes its DIFF
phase attributed to a repo.

| | `/update` | `/vault-sync` |
|---|---|---|
| Source of truth | chat + tracker channels (Telegram, Slack, Jira, gh/glab issue lists) | one repo's own git history + cbm graph |
| Writes vault notes | never — surfaces `notes_to_refresh[]` for the operator | yes, this is the point |
| Writes bd memories | yes (`update-sync-*` facts) | one marker per repo (`vault-sync-marker-<repo>`) |
| Scope | the whole machine persona's source set | a single repo passed as `repo=` |

## Command

```
/vault-sync repo=~/dev/<org>/infra-salt
/vault-sync repo=<service>-backend since=2026-07-01 dryRun=true
/vault-sync repo=~/dev/<org>/<org> maxNotes=3
```

| Arg | Default | Meaning |
|---|---|---|
| `repo=` | — (required) | Absolute path, `~`-path, or bare name resolved under `~/dev` and `~/dev/*/`. Must contain `.git`. `repo=all` iterates every skill-backed repo on this host, sequentially, one marker each. |
| `maxRepos=` | 8 (max 16) | Cap for `repo=all`, most-recently-committed first. |
| `dir=` / `root=` | — | With `repo=all`, enumerate every git checkout directly under this directory instead of only skill-backed repos. Includes repos with no skill yet; dedupes ticket/worktree clones of one upstream by comparing `origin` URLs. |
| `since=` | last synced SHA, else 14 days | Start of the scan window (rev or date). |
| `dryRun=true` | `false` | Plan and return the note edits without writing. `apply=false` is an alias. |
| `maxNotes=` | 6 (max 12) | Cap on notes touched per run. |
| `bead=` | derived | Correlate the run with an existing bead. |

Every one of those keys is registered in `CONTROL_KEYS` (`src/fragments/args.js`). If a
future key is not, its token falls into positionals and the workflow silently uses the
default — which for this workflow means writing. Two guards: unparsed `key=value` tokens
are recovered from the positionals, and any flag this workflow does not recognize forces
`dryRun` and reports `arg_warning` in the result. Found the hard way: the first live run
wrote a note with `dryRun=true` set.

## Phases

1. **Scope** — resolve `repo_path`, `default_branch`, the `since` marker (`bd memories vault-sync-marker-<repo>`), the vault directory the repo's notes belong in (per `vault/CLAUDE.md` folder rules + machine persona), the existing notes that mention the repo, the repo's skill id, and whether the repo is indexed in cbm.
2. **Scan** — `git fetch`, then commits / merges / `--name-status` over `since..origin/<default_branch>`; merged MRs/PRs via `glab`/`gh` when authenticated (soft-fails into `scan_gaps[]`); `detect_changes` + `get_architecture` + `trace_path` from cbm to name the affected subsystem. Output is grouped **by area**, not one entry per commit, and each area carries an `upgrade_impact` — what an operator must now do differently.
3. **Diff** — re-search the vault per changed area (Scope only searched by repo name, which misses notes covering a subsystem without naming it), read every candidate hit and the repo skill, then plan `note_edits[]` and `skill_drift[]`.

   **Update by default, create on a proven gap.** If any note covers the area it gets an `update`, even when the fit is partial — a second note about the same subsystem is worse than an untidy first one. An `action: create` must carry `gap_evidence[]` (the searches that returned nothing); the workflow drops creates without it, because "I didn't find one" is how duplicate notes get made. The result splits `created[]` from `updated[]`.
4. **Grade** — score the plan against `prompts/rubrics/vault-note-rubric.md` before anything is written. This workflow is the only one that writes vault notes and had no gate at all, while every other writing workflow is grade-gated. Hard gates: every claim cited, nothing invented beyond the scan, `create` carries `gap_evidence`, and **no credential material in any note** (these repos carry plaintext tokens in config, and a note quoting one leaks it into a synced vault). A non-APPROVE verdict returns `vault_sync_rejected` with findings and writes nothing. The gate runs *before* the `dryRun` exit, so a preview shows the verdict too.
5. **Write** — apply the surviving edits, set frontmatter `Modified`, then run the precomputed `bd remember` marker command so the next run is incremental.

## Guardrails

- **Target repo is read-only.** `git fetch` is allowed; checkout, reset, commit, push, and file edits are forbidden in both the scan and write prompts.
- **Writes are constrained in JS, not in the prompt.** Only `vault/**.md` paths with no `..` survive `safeEdits`; anything else is dropped and reported as `rejected_edits`. A compromised or confused plan cannot reach the repo or the skills tree.
- **Marker key is derived in JS** from the `repo=` argument (kebab-cased, length-capped) and the `bd remember` command is precomputed, so agent output can never retarget another memory key.
- **Skills are never edited.** Code/skill contradictions come back as `skill_drift[]`; `/improve` owns skill mutation. That seam is now wired: `/improve`'s Analyze phase reads `skill_drift[]` out of VaultSync bead entries, counts the items toward its feedback threshold, and tags those clusters `source: 'vault_sync_drift'` — a drift item arrives with the skill already identified and the evidence already gathered.
- **Nothing is committed in zk-artifacts.** Review the vault diff yourself.
- **Untrusted-input fence.** Commit messages and MR titles are colleague-authored text feeding a phase whose output gets written to files, so the scan payload is wrapped in the same `UNTRUSTED_EXTERNAL_DATA` fence `/update` puts around chat text. The write phase is told each `content` string is prose to write, never a command to run.
- Empty scan or empty plan returns `vault_sync_complete` before the Write phase runs.

## Output

```jsonc
{
  "verdict": "vault_sync_complete",     // or vault_sync_dry_run / vault_sync_rejected
  "grade": "APPROVE",
  "repo": "infra-salt",
  "since": "a1b2c3d…",                  // and since_source: bd_marker | arg | default_window
  "head_sha": "…",
  "commit_count": 37,
  "notes_written": ["vault/Notes/Work/<org>/Tech/infra-salt Alert Routing.md"],
  "rejected_edits": 0,
  "skill_drift": [{ "skill_id": "agent/machines/n/repos/infra-salt", "item": "…", "evidence": "…" }],
  "scan_gaps": []
}
```

Read `scan_gaps[]` before trusting a thin sync — a missing `glab` auth or an unindexed repo shows up there rather than as a failure.
