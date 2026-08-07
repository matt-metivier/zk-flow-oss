// src/fragments/bd-memory.js
// bd message convention: "<Type>: <json>".
export function assertId(id) {
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(id)) throw new Error(`invalid bead id: ${id}`);
  return id;
}
// All bd recipes cd into the zk-flow workspace first — workflow agents inherit
// the session cwd, and a persist agent running in ~/dev found no beads db
// (run memory lost until the round-trip verify caught it).
const BD_CD = 'cd "${ZK_FLOW_DIR:-$HOME/dev/zk-flow}" && ';
export function bdShow(id) { const v = assertId(id); return `${BD_CD}bd show ${v} --json`; }
export function bdReady(label) { return label ? `${BD_CD}bd ready --label ${label}` : `${BD_CD}bd ready`; }
// bdWrite returns a shell snippet an AGENT runs (workflow scripts can't run bash):
// create the bead if absent, then append a typed evidence comment WITH the body on stdin.
export function bdWrite(id, type, payloadObj) {
  const v = assertId(id);
  // Guard: a payload line equal to the heredoc delimiter would truncate the comment.
  const body = `${type}: ${JSON.stringify(payloadObj)}`.split('\n').map(l => l === 'ZKEOF' ? ' ZKEOF' : l).join('\n');
  // bd create requires a positional title; without it the create silently failed and all run memory was lost.
  // The trailing verify round-trips the comment back out — persistence failures must be loud, never /dev/null'd.
  return `${BD_CD}\n${bdCommentStagingPreamble()}\nif ! cat > "$zkflow_bd_tmp" <<'ZKEOF'\n${body}\nZKEOF\nthen\n  echo '{"ok":false,"reason":"bd comment staging failed for ${v}"}'\n  exit 1\nfi\n${bdCommentFinish(v, type, `bd comment round-trip verify failed for ${v}`)}`;
}
// Lifecycle transition: open -> in_progress. Idempotent (`bd update --claim` is
// a no-op if already claimed). Creates the bead first if a run claims before any
// phase has persisted to it, so the claim never fails on a missing id. Emits the
// {"ok":...} status line the persist agent / PERSIST_RESULT_SCHEMA expects.
export function bdClaim(id) {
  const v = assertId(id);
  return `${BD_CD}bd show ${v} >/dev/null 2>&1 || bd create "zk-flow run: ${v}" --id ${v} -t task\nbd update ${v} --claim >/dev/null 2>&1 && echo '{"ok":true}' || echo '{"ok":false,"reason":"bd claim failed for ${v}"}'`;
}
// Lifecycle transition: in_progress -> closed. Optional reason. Soft by design —
// callers run this via persistPhaseSoft-style so a close failure never aborts a
// successful run's terminal return.
export function bdClose(id, reason) {
  const v = assertId(id);
  const r = reason ? ` -r ${JSON.stringify(String(reason))}` : '';
  return `${BD_CD}bd close ${v}${r} >/dev/null 2>&1 && echo '{"ok":true}' || echo '{"ok":false,"reason":"bd close failed for ${v}"}'`;
}
// Private: POSIX single-quote escaper. Single-quoted shell strings disable ALL
// expansion ($(...), backticks, $VAR). The sequence '\'' embeds a literal quote.
// Safe for keyword/insight/key in every argument AND echo-label position.
const shq = s => "'" + String(s).replace(/'/g, "'\\''") + "'";
const bdCommentStagingPreamble = () => [
  'zkflow_bd_tmp="$(mktemp "${TMPDIR:-/tmp}/zk-flow-bd-comment.XXXXXX")" || exit 1',
  'zkflow_bd_body="${zkflow_bd_tmp}.body"',
  'trap \'rm -f "$zkflow_bd_tmp" "$zkflow_bd_body"\' EXIT HUP INT TERM'
].join('\n');
const bdCommentFinish = (v, type, failReason) => [
  'mv "$zkflow_bd_tmp" "$zkflow_bd_body"',
  `bd show ${v} >/dev/null 2>&1 || bd create "zk-flow run: ${v}" --id ${v} -t task`,
  `bd comment ${v} --stdin < "$zkflow_bd_body"`,
  `bd comments ${v} | grep -q ${shq(`${type}:`)} && echo '{"ok":true}' || echo '{"ok":false,"reason":"${failReason}"}'`
].join('\n');
// Private: integer clamp for --limit flags. parseInt radix 10 avoids octal misparse.
// Clamps to ceiling 100 (anti-bloat) and floor 1. Non-numeric falls back to def.
const lim = (n, def) => { const p = parseInt(n, 10); return Number.isFinite(p) ? Math.min(100, Math.max(1, p)) : def; };
// Durable cross-session knowledge. `bd remember` memories are injected at `bd prime`
// time, so an insight written here is available in every future session without manual
// loading. `key` makes the memory addressable/updatable (re-remembering the same key
// overwrites). This is the write side of the bd memories lane that zk-flow-xj3's bounded
// retrieval reads.
export function bdRemember(insight, key) {
  const text = shq(String(insight));
  const k = key ? ` --key ${shq(String(key))}` : '';
  const failReason = key ? `bd remember failed for key ${String(key)}` : 'bd remember failed (no key)';
  const okStatus = shq(JSON.stringify({ ok: true }));
  const failStatus = shq(JSON.stringify({ ok: false, reason: failReason }));
  return `${BD_CD}bd remember ${text}${k} >/dev/null 2>&1 && echo ${okStatus} || echo ${failStatus}`;
}
// Read side: list/search durable memories. Returns raw bd output (not JSON) for an
// agent to fold into discover/research context. `keyword` narrows via FTS.
export function bdMemories(keyword) {
  const k = keyword ? ` ${shq(String(keyword))}` : '';
  return `${BD_CD}bd memories${k}`;
}
// Bounded context window (TradingAgents get_past_context pattern): most-recent
// same-subject beads (bd search FTS) + cross-subject recency window (bd list).
// nSame/nCross are integer-validated and clamped 1..100 (anti-bloat ceiling).
// keyword is POSIX single-quote escaped in both the argument and echo-label positions.
export function bdBoundedContext(keyword, { nSame = 5, nCross = 3 } = {}) {
  const kq = shq(String(keyword));
  const ns = lim(nSame, 5);
  const nc = lim(nCross, 3);
  return `${BD_CD}echo "=== same-subject: ${kq} (n=${ns}) ===" && bd search ${kq} --sort created --reverse --limit ${ns} --json\n${BD_CD}echo '=== cross-subject recency ===' && bd list --sort created --reverse --limit ${nc} --json`;
}

// Per-phase checkpoint write side. Checkpoints are durable bd memories keyed by
// bead+phase, while the full payload remains shell-quoted through bdRemember.
export function bdPhaseCheckpoint(id, phase, payload) {
  const v = assertId(id);
  const p = String(phase);
  return bdRemember(`PhaseCheckpoint: ${JSON.stringify({ bead: v, phase: p, payload })}`, `${v}:phase:${p}`);
}
// Resume read side: exact phase checkpoint memories first, then a bounded bead
// context window to recover nearby run comments without flooding the prompt.
export function bdPhaseResumeContext(id, phase, { nSame = 5, nCross = 3 } = {}) {
  const v = assertId(id);
  const p = String(phase);
  return `${bdMemories(`${v}:phase:${p}`)}
${bdBoundedContext(`${v} ${p} checkpoint`, { nSame, nCross })}`;
}
// Attach a prose artifact file (e.g. $TMPDIR/research.md, $TMPDIR/design.md) to the
// bead as a typed comment, so the human-readable phase output the grader reads is
// reconstructable from the bead alone — not lost when $TMPDIR is reaped. The JSON
// synthesis stays the load-bearing copy; this is the rich companion. No-op (ok:true)
// when the file is absent/empty so a phase that wrote none never fails the run.
// `path` is a fixed workflow literal (e.g. '$TMPDIR/research.md'); it is shell-expanded
// in the persist agent, so it must NOT be quoted away — validated against a safe charset.
export function bdAttachFile(id, type, path) {
  const v = assertId(id);
  if (!/^[$A-Za-z0-9._/{}-]+$/.test(path)) throw new Error(`unsafe artifact path: ${path}`);
  return `${BD_CD}\n[ -s "${path}" ] || { echo '{"ok":true,"reason":"no artifact at ${path}"}'; exit 0; }\n${bdCommentStagingPreamble()}\nif ! { printf '%s\\n' ${shq(`${type}:`)}; cat "${path}"; } > "$zkflow_bd_tmp"; then\n  echo '{"ok":false,"reason":"artifact staging failed for ${v}"}'\n  exit 1\nfi\n${bdCommentFinish(v, type, `artifact attach round-trip failed for ${v}`)}`;
}
