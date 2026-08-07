// src/fragments/bead-run.js
// Shared bead-id derivation and phase-persistence helper.
// Used by all lifecycle workflows (feature, small-feature, design, research, test, finish-pr).
// Inlined at build time (no import); no unit tests (agent() is integration-only).
export function runBeadId(a) {
  // bd ids must be clean [a-z0-9-]: dots/underscores/repeated dashes made
  // `bd create --id` fail in live runs (and violate discover.json's
  // related_beads pattern). Collapse everything else to single dashes.
  const clean = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  // The bd db enforces a 'zk-flow-' id prefix; a bead= that lacks it makes
  // `bd create --id` fail ("prefix mismatch ... requires --force") and every
  // phase persist round-trip then fails, aborting the run. Brief/pr-derived
  // ids already carry the prefix — apply the same guard to explicit bead=.
  const withPrefix = (id) => id.startsWith('zk-flow-') ? id : 'zk-flow-' + id;
  if (a.bead) {
    // Run-1 and run-2 with the same bead= normalize identically, preserving correlation.
    return withPrefix(clean(a.bead));
  }
  if (a.pr) {
    // Stable pr-derived id so finish-pr (no positional a._) doesn't collapse to 'zkflow-run'.
    return 'zk-flow-pr-' + clean(a.pr);
  }
  // Slug from positional text, else the brief — otherwise brief=-only invocations
  // (no a._) all collapse onto the single 'zk-flow-run' bead and co-mingle phases.
  const source = (a._ && a._.length) ? a._.join('-') : (a.brief || '');
  const slug = source ? clean(source).slice(0, 40).replace(/-+$/, '') : 'run';
  return 'zk-flow-' + (slug || 'run'); // note: pass bead=<id> to correlate run-1/run-2 (sandbox has no nonce)
}

// Deterministic per-bead run branch (fixes zk-flow-ts2). Writer agents run with
// `isolation: worktree`, so the runtime ALREADY sandboxes each in its own private
// worktree sharing the repo .git — they cannot touch the main checkout. This
// helper only puts the agent on the deterministic branch so commits persist in
// the shared .git after the per-agent worktree is torn down. The branch name is
// the cross-agent handoff key.
export function workspaceBranch(beadId) {
  return `zkflow/${beadId}`;
}

// Proof-of-work artifact (Symphony pattern): bundle a successful run's acceptance
// signals into one object so a human can accept the work from a single summary.
// Persisted to the bead (type 'ProofOfWork') and returned by the workflow.
// Null-safe — small-feature has no reviewGrade; testing may be absent.
export function buildProofOfWork({ verdict, route, beadId, implResult, reviewGrade, testing } = {}) {
  const out = (implResult && implResult.out) || {};
  const t = (testing && testing.out) || null;
  return {
    bead: beadId || null,
    branch: beadId ? workspaceBranch(beadId) : null,
    verdict: verdict || null,
    route: route || null,
    files_changed: out.files_changed || [],
    commits: out.commits || [],
    review: reviewGrade ? (reviewGrade.verdict || null) : null,
    // smoke_unsupported testing has no tests_passed/failed — keep the smoke outcome
    // so the proof still records that testing RAN (exit 0) instead of a bare
    // {passed:null,failed:null} that reads as "no signal" (zk-flow-pna).
    tests: t ? { passed: t.tests_passed ?? null, failed: t.tests_failed ?? null, outcome: t.outcome ?? null, smoke_exit_code: t.smoke_exit_code ?? null } : null,
    // Operator-runnable cost command. The workflow cannot read its own runId
    // (sandbox bans process.env/new Date), and nothing prints one for an operator
    // to substitute — so this is SELF-RESOLVING: it embeds the same newest-run
    // discovery the daemon uses (find -path '*subagents*' -name 'wf_*') so it is
    // copy-paste runnable. Best-effort: resolves the most recent run's transcripts.
    cost_cmd: "scripts/run-cost.sh \"$(find ~/.claude/projects -type d -path '*subagents*' -name 'wf_*' | sort | tail -1)\"",
  };
}
// Bash block injected into writer/pr-author prompts. Does NOT create a worktree
// (the runtime does, via isolation:worktree) and does NOT `cd` (the prior
// `git worktree add` + cd approach failed — Edit/Write resolve absolute paths
// into main regardless of shell cwd; only runtime isolation truly sandboxes).
//   opts.branch       : work on an EXISTING branch (finish-pr passes the PR branch)
//                       instead of the run branch zkflow/<beadId>.
//   opts.fetch        : `git fetch origin <branch>` first (finish-pr / readers).
//   opts.checkoutOnly : reader (pr-author) — get onto the writer's branch WITHOUT
//                       `-B` (which would reset it and discard the writer commits).
export function workspaceBootstrap(beadId, opts = {}) {
  const branch = opts.branch || workspaceBranch(beadId);
  const lines = [
    '## Workspace bootstrap — RUN FIRST (you are in an isolated worktree; get on the run branch)',
    '```bash',
    `BR="${branch}"`,
  ];
  if (opts.fetch) lines.push('git fetch origin "$BR" 2>/dev/null || true');
  if (opts.checkoutOnly) {
    // reader: never -B (would discard the writer's commits)
    lines.push('git checkout "$BR" 2>/dev/null || git checkout -B "$BR" "origin/$BR" 2>/dev/null || true');
  } else if (opts.branch) {
    // finish-pr writer: continue the existing PR branch — do NOT reset it
    lines.push('git checkout "$BR" 2>/dev/null || git checkout -B "$BR" "origin/$BR"');
  } else {
    // feature/small-feature writer: continue the run branch if it exists (later iterations
    // get a FRESH isolation worktree at main HEAD — a bare `-B` would reset the
    // branch and discard earlier iterations' commits), else create it.
    lines.push('git checkout "$BR" 2>/dev/null || git checkout -B "$BR"');
  }
  lines.push('echo "on branch: $(git rev-parse --abbrev-ref HEAD)"', '```');
  return lines.join('\n');
}
// External-repo isolation procedure. The runtime isolation worktree only sandboxes
// the agent's OWN repo (cwd); when the writer edits EXTERNAL repos by absolute path,
// the edit lands in that repo's main checkout on whatever branch it has checked out
// — observed in practice committing onto an unrelated feature branch. We cannot
// resolve repo roots in JS (target paths arrive as {file,change} objects AND may be
// repo-relative), so emit an agent-callable shell helper `zkiso <abs-repo-path>`
// keyed only on the bead: the writer calls it for each EXTERNAL target repo (absolute
// paths are in the request) BEFORE editing, getting a per-bead worktree on
// zkflow/<beadId> branched off the repo's origin default. `files` is used only to
// surface any absolute paths we can already see as a reminder.
export function workspaceBootstrapRepos(beadId, files = []) {
  const id = String(beadId);
  const paths = (files || [])
    .map(f => (typeof f === 'string' ? f : (f && typeof f === 'object' ? f.file : null)))
    .filter(p => typeof p === 'string' && p.charAt(0) === '/' && /^[A-Za-z0-9._\/@+-]+$/.test(p));
  const hint = paths.length ? 'Absolute target paths seen: ' + paths.join(', ') : '';
  return [
    '## External-repo isolation — RUN FIRST for every target repo OUTSIDE your current worktree',
    'Editing an external repo by absolute path commits onto whatever branch it has checked out,',
    'corrupting unrelated branches. For EACH distinct external target repo (absolute repo paths',
    'are in the request above), call `zkiso <absolute-repo-path>` BEFORE editing it, then edit and',
    'commit ONLY inside the worktree path it prints — never the original checkout.',
    hint,
    '```bash',
    `BEAD='${id}'`,
    'zkiso() {',
    '  root=$(git -C "$1" rev-parse --show-toplevel 2>/dev/null) || { echo "zkiso: not a git repo: $1"; return 1; }',
    '  br="zkflow/$BEAD"; ws="${ZKFLOW_WORKDIR:-$HOME/.zkflow/worktrees}/${BEAD}__$(basename "$root")"',
    '  if [ -d "$ws" ]; then echo "WORKTREE(reuse): $root -> $ws — edit & commit HERE"; return 0; fi',
    '  mkdir -p "$(dirname "$ws")"',
    '  base=$(git -C "$root" symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null || echo origin/master)',
    '  git -C "$root" fetch -q origin 2>/dev/null || true',
    '  if git -C "$root" show-ref --verify --quiet "refs/heads/$br"; then git -C "$root" worktree add "$ws" "$br" 2>/dev/null || { echo "zkiso: $br busy in $root"; return 1; }',
    '  else git -C "$root" worktree add "$ws" -b "$br" "$base" 2>/dev/null || git -C "$root" worktree add "$ws" -b "$br"; fi',
    '  echo "WORKTREE: $root -> $ws (branch $br) — edit & commit HERE, not $root"',
    '}',
    '```',
  ].filter(Boolean).join('\n');
}
const PERSIST_RESULT_SCHEMA = {
  type: 'object',
  required: ['ok'],
  properties: { ok: { type: 'boolean' }, reason: { type: 'string' } },
  additionalProperties: false,
};

export async function persistPhase(beadId, type, payload) {
  const result = await agent(
    `Persist run memory. Run EXACTLY this shell. The last line it prints is a JSON status — emit that JSON (fields at top level) via StructuredOutput:\n\`\`\`\n${bdWrite(beadId, type, payload)}\n\`\`\``,
    { label: 'persist:' + type.toLowerCase(), agentType: 'persist', model: MODEL_TIERS.fast, schema: PERSIST_RESULT_SCHEMA }
  );
  // Run memory is load-bearing (resume, self-improve, audit trails). A silent
  // persistence failure cost this project its entire bd history once — never again.
  if (!result || result.ok !== true) {
    throw new Error(`[persist:${type}] bd persistence failed for ${beadId}: ${(result && result.reason) || 'no status returned'}`);
  }
  return result;
}


export async function persistPhaseCheckpoint(beadId, phase, payload) {
  const result = await agent(
    `Persist phase checkpoint. Run EXACTLY this shell. The last line it prints is a JSON status — emit that JSON (fields at top level) via StructuredOutput:
\`\`\`
${bdPhaseCheckpoint(beadId, phase, payload)}
\`\`\``,
    { label: 'checkpoint:' + String(phase).toLowerCase(), agentType: 'persist', model: MODEL_TIERS.fast, schema: PERSIST_RESULT_SCHEMA }
  );
  if (!result || result.ok !== true) {
    throw new Error(`[checkpoint:${phase}] bd checkpoint failed for ${beadId}: ${(result && result.reason) || 'no status returned'}`);
  }
  return result;
}

// Non-throwing variant of persistPhase for NON-load-bearing writes (verification counts,
// FixTask routing, advisory telemetry). persistPhase stays strict for load-bearing run
// memory (resume/self-improve/audit); persistPhaseSoft swallows failures so a soft write
// can never abort a run. Returns the status object, or {ok:false,reason} on any failure.
export async function persistPhaseSoft(beadId, type, payload) {
  try {
    const result = await agent(
      `Persist run memory. Run EXACTLY this shell. The last line it prints is a JSON status — emit that JSON (fields at top level) via StructuredOutput:\n\`\`\`\n${bdWrite(beadId, type, payload)}\n\`\`\``,
      { label: 'persist:' + type.toLowerCase(), agentType: 'persist', model: MODEL_TIERS.fast, schema: PERSIST_RESULT_SCHEMA }
    );
    return result || { ok: false, reason: 'no status returned' };
  } catch (e) {
    console.warn(`[persistSoft:${type}] non-fatal persistence failure for ${beadId}: ${(e && e.message) || e}`);
    return { ok: false, reason: String((e && e.message) || e) };
  }
}

// Generic soft runner for a bd lifecycle shell snippet (claim/close/remember).
// Mirrors persistPhaseSoft: spawns the fast persist agent, never throws — a
// lifecycle transition failure must not abort an otherwise-successful run.
// The snippet's last printed line must be the {"ok":...} JSON status.
async function runBdLifecycleSoft(beadId, label, snippet) {
  try {
    const result = await agent(
      `Run EXACTLY this shell. The last line it prints is a JSON status — emit that JSON (fields at top level) via StructuredOutput:\n\`\`\`\n${snippet}\n\`\`\``,
      { label: 'bd:' + label, agentType: 'persist', model: MODEL_TIERS.fast, schema: PERSIST_RESULT_SCHEMA }
    );
    return result || { ok: false, reason: 'no status returned' };
  } catch (e) {
    console.warn(`[bd:${label}] non-fatal lifecycle failure for ${beadId}: ${(e && e.message) || e}`);
    return { ok: false, reason: String((e && e.message) || e) };
  }
}
// open -> in_progress. Call once, right after runBeadId(a) resolves, before the
// first phase. Soft: a claim failure is logged, not fatal.
export async function claimRun(beadId) {
  return runBdLifecycleSoft(beadId, 'claim', bdClaim(beadId));
}
// in_progress -> closed. Call once, immediately before a workflow's terminal
// success return (after ProofOfWork is persisted). Soft so close failure can
// never swallow the run's verdict.
export async function closeRun(beadId, reason) {
  return runBdLifecycleSoft(beadId, 'close', bdClose(beadId, reason));
}
// Distill one durable insight to bd memories (injected at every future `bd prime`).
// Soft. Used by the /improve reflector to persist clustered learnings.
export async function rememberInsight(beadId, insight, key) {
  return runBdLifecycleSoft(beadId, 'remember', bdRemember(insight, key));
}
// Attach a phase's prose artifact ($TMPDIR/research.md, $TMPDIR/design.md) to the bead
// as a typed comment (ResearchDoc / DesignDoc). Soft and no-op-if-absent: the JSON
// synthesis is the load-bearing copy, so a missing/failed doc never aborts the run.
// Call right after the phase's persistPhase(JSON) so both land together.
export async function persistArtifact(beadId, type, path) {
  return runBdLifecycleSoft(beadId, 'artifact:' + type.toLowerCase(), bdAttachFile(beadId, type, path));
}

// Writes a solution summary to vault/Solutions/ so future discover phases can find it.
// Call after successful workflow completion with the key artifacts.
export async function persistSolution(label, summary, { request, approach, files = [], beadId = null } = {}) {
  // Sandbox-safe: no process.env / new Date() here (Workflow sandbox bans both).
  // Env presence and the date are resolved in the persist agent's shell.
  const slug = label.replace(/[^a-z0-9-]/gi, '-').replace(/-+/g, '-').toLowerCase().slice(0, 50);
  const content = [
    `# ${label}`,
    beadId ? `Bead: ${beadId}` : '',
    '',
    '## Request',
    request || '',
    '',
    '## Approach',
    approach || summary || '',
    '',
    files.length ? `## Key files\n${files.map(f => '- ' + f).join('\n')}` : '',
  ].filter(l => l !== undefined).join('\n').trim();
  const shellCmd = `[ -n "$ZK_ARTIFACTS_DIR" ] || { echo '{"skipped":"ZK_ARTIFACTS_DIR unset"}'; exit 0; }
D=$(date +%F)
mkdir -p "$ZK_ARTIFACTS_DIR/vault/Solutions"
{ echo "Date: $D"; cat << 'SOLEOF'
${content}
SOLEOF
} > "$ZK_ARTIFACTS_DIR/vault/Solutions/$D-${slug}.md"`;
  return agent('Write solution to vault. Run EXACTLY:\n```\n' + shellCmd + '\n```', { label: 'persist:solution', agentType: 'persist', model: MODEL_TIERS.fast });
}
