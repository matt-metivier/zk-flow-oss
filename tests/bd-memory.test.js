// tests/bd-memory.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bdWrite, bdShow, bdReady, assertId, bdRemember, bdMemories, bdBoundedContext, bdAttachFile } from '../src/fragments/bd-memory.js';

test('bdWrite includes the <Type>: {json} body', () => {
  const snippet = bdWrite('abc-123', 'GraderFeedback', { passed: true });
  assert.ok(snippet.includes('GraderFeedback: {"passed":true}'), 'body must be in snippet');
});
test('bdWrite includes create-if-absent guard', () => {
  const snippet = bdWrite('abc-123', 'GraderFeedback', { passed: true });
  assert.ok(snippet.includes('bd show abc-123 >/dev/null 2>&1 || bd create "zk-flow run: abc-123" --id abc-123 -t task'), 'create-if-absent guard (with required title) missing');
  assert.ok(!snippet.includes('-t task >/dev/null'), 'create stderr must NOT be suppressed — persistence failures stay loud');
});
test('bdWrite includes round-trip verify with JSON status', () => {
  const snippet = bdWrite('abc-123', 'GraderFeedback', { passed: true });
  assert.ok(snippet.includes("bd comments abc-123 | grep -q 'GraderFeedback:'"), 'round-trip verify missing');
  assert.ok(snippet.includes('{"ok":true}') && snippet.includes('{"ok":false'), 'JSON status lines missing');
});
test('bdWrite includes bd comment with --stdin', () => {
  const snippet = bdWrite('abc-123', 'GraderFeedback', { passed: true });
  assert.ok(snippet.includes('bd comment abc-123 --stdin'), '--stdin missing');
});
test('bdWrite stages the comment body with temp-plus-atomic-mv before bd comment', () => {
  const snippet = bdWrite('abc-123', 'GraderFeedback', { passed: true });
  const mktemp = snippet.indexOf('mktemp "${TMPDIR:-/tmp}/zk-flow-bd-comment.XXXXXX"');
  const heredoc = snippet.indexOf("cat > \"$zkflow_bd_tmp\" <<'ZKEOF'");
  const rename = snippet.indexOf('mv "$zkflow_bd_tmp" "$zkflow_bd_body"');
  const comment = snippet.indexOf('bd comment abc-123 --stdin < "$zkflow_bd_body"');
  assert.ok(mktemp >= 0, 'atomic temp file allocation missing');
  assert.ok(heredoc > mktemp, 'body must be written into the temp file');
  assert.ok(rename > heredoc, 'temp body must be atomically renamed after full write');
  assert.ok(comment > rename, 'bd comment must read only the renamed complete body');
  assert.ok(snippet.includes('trap \'rm -f "$zkflow_bd_tmp" "$zkflow_bd_body"\' EXIT HUP INT TERM'), 'temp cleanup trap missing');
});
test('bdAttachFile stages artifact content with temp-plus-atomic-mv before bd comment', () => {
  const snippet = bdAttachFile('abc-123', 'ResearchArtifact', '$TMPDIR/research.md');
  const presenceCheck = snippet.indexOf('[ -s "$TMPDIR/research.md" ]');
  const mktemp = snippet.indexOf('mktemp "${TMPDIR:-/tmp}/zk-flow-bd-comment.XXXXXX"');
  const artifactWrite = snippet.indexOf('{ printf \'%s\\n\' \'ResearchArtifact:\'; cat "$TMPDIR/research.md"; } > "$zkflow_bd_tmp"');
  const rename = snippet.indexOf('mv "$zkflow_bd_tmp" "$zkflow_bd_body"');
  const comment = snippet.indexOf('bd comment abc-123 --stdin < "$zkflow_bd_body"');
  assert.ok(presenceCheck >= 0, 'artifact absence guard missing');
  assert.ok(mktemp > presenceCheck, 'atomic temp file allocation missing');
  assert.ok(artifactWrite > mktemp, 'artifact must be copied into the temp file');
  assert.ok(rename > artifactWrite, 'temp artifact body must be atomically renamed after full copy');
  assert.ok(comment > rename, 'bd comment must read only the renamed complete artifact body');
  assert.ok(snippet.includes('trap \'rm -f "$zkflow_bd_tmp" "$zkflow_bd_body"\' EXIT HUP INT TERM'), 'temp cleanup trap missing');
});
test('bdShow / bdReady build read commands (cwd-proof)', () => {
  const CD = 'cd "${ZK_FLOW_DIR:-$HOME/dev/zk-flow}" && ';
  assert.equal(bdShow('abc-123'), CD + 'bd show abc-123 --json');
  assert.equal(bdReady('self-improve'), CD + 'bd ready --label self-improve');
  assert.equal(bdReady(), CD + 'bd ready');
});
test('bead id is validated - rejects spaces, uppercase, and leading dash', () => {
  assert.throws(() => bdShow(''));
  assert.throws(() => bdShow('bad id'));
  assert.throws(() => bdShow('BadID'));
  assert.throws(() => bdShow('-x'), 'leading dash must be rejected');
  assert.throws(() => bdShow('--id'), 'leading dashes must be rejected');
});
test('bead id accepts dots, dashes, underscores', () => {
  assert.doesNotThrow(() => bdShow('my.bead-id_1'));
  assert.doesNotThrow(() => bdShow('zkflow-foo'));
  assert.doesNotThrow(() => bdShow('a.b_c'));
  assert.doesNotThrow(() => bdWrite('my.bead-id_1', 'T', {}));
});

// --- bdRemember ---
test('bdRemember uses single-quote shape for insight and emits ok/fail status', () => {
  const snippet = bdRemember('my insight', 'mykey');
  // single-quote wrapped argument
  assert.ok(snippet.includes("bd remember 'my insight' --key 'mykey'"), 'single-quote shape missing');
  // status lines are shq(JSON.stringify) — single-quote wrapped (starts and ends with ')
  assert.ok(snippet.includes("'my insight'"), 'insight must be single-quote wrapped');
  assert.ok(snippet.includes('bd remember failed for key mykey'), 'failure reason must anchor the key');
});
test('bdRemember with no key uses (no key) in failure reason', () => {
  const snippet = bdRemember('some insight');
  assert.ok(snippet.includes('bd remember failed (no key)'), '(no key) reason missing');
  assert.ok(!snippet.includes('--key'), '--key must be absent when no key provided');
});
test('bdRemember emits status as shq(JSON.stringify) — single-quote wrapped', () => {
  const snippet = bdRemember('insight', 'k');
  // The status line must be single-quote wrapped (shq output starts with ')
  // Match: echo '{"ok":true}' or echo '{"ok":false,...}'
  assert.ok(/echo '{"ok":true}'/.test(snippet), 'ok status must be single-quote wrapped JSON');
  assert.ok(/echo '{"ok":false/.test(snippet), 'fail status must be single-quote wrapped JSON');
});

// --- bdMemories ---
test('bdMemories uses single-quote shape for keyword', () => {
  const snippet = bdMemories('memory keyword');
  assert.ok(snippet.includes("bd memories 'memory keyword'"), 'single-quote shape missing');
});
test('bdMemories with no keyword omits the argument', () => {
  const snippet = bdMemories();
  assert.ok(snippet.includes('bd memories') && !snippet.includes("bd memories '"), 'keyword must be omitted when not provided');
});

// --- bdBoundedContext ---
test('bdBoundedContext emits same-subject bd search and cross-subject bd list lanes', () => {
  const snippet = bdBoundedContext('my topic');
  assert.ok(snippet.includes("bd search 'my topic'"), 'same-subject search missing');
  assert.ok(snippet.includes('bd list'), 'cross-subject list missing');
  assert.ok(snippet.includes('--sort created --reverse'), '--sort created --reverse missing');
});
test('bdBoundedContext uses single-quote shape for keyword in argument position', () => {
  const snippet = bdBoundedContext('test keyword');
  assert.ok(snippet.includes("bd search 'test keyword'"), 'keyword must be single-quote wrapped in search arg');
});
test('bdBoundedContext uses single-quote shape for keyword in echo-label position', () => {
  const snippet = bdBoundedContext('test keyword');
  assert.ok(snippet.includes("'test keyword'"), 'keyword must be single-quote wrapped in echo label');
});
test('bdBoundedContext default limits are 5 and 3', () => {
  const snippet = bdBoundedContext('k');
  assert.ok(snippet.includes('--limit 5'), 'default nSame=5 missing');
  assert.ok(snippet.includes('--limit 3'), 'default nCross=3 missing');
});
test('bdBoundedContext accepts custom nSame/nCross', () => {
  const snippet = bdBoundedContext('k', { nSame: 10, nCross: 7 });
  assert.ok(snippet.includes('--limit 10'), 'custom nSame=10 missing');
  assert.ok(snippet.includes('--limit 7'), 'custom nCross=7 missing');
});
test('bdBoundedContext is BD_CD-prefixed', () => {
  const CD = 'cd "${ZK_FLOW_DIR:-$HOME/dev/zk-flow}" && ';
  const snippet = bdBoundedContext('k');
  assert.ok(snippet.startsWith(CD), 'BD_CD prefix missing');
});

// --- Adversarial regressions ---
test('adversarial: bdBoundedContext with single-quote keyword uses embedded escape sequence', () => {
  // "it's" must produce 'it'\''s' (no bare string-terminating single quote)
  const snippet = bdBoundedContext("it's");
  // The escaped form must appear: 'it'\''s'
  assert.ok(snippet.includes("'it'\\''s'"), "single-quote in keyword must use '\\'\\'' escape sequence");
  // No bare un-escaped single quote that would terminate the shell string prematurely
  // The label and arg must use the proper escape, not a naive unescaped quote
  assert.ok(!snippet.match(/'it's'/), "bare unescaped single quote must not appear");
});
test('adversarial: bdBoundedContext with $(whoami) keeps substitution inside single quotes', () => {
  const snippet = bdBoundedContext('$(whoami)');
  // Must appear inside single quotes
  assert.ok(snippet.includes("'$(whoami)'"), '$(whoami) must be inside single quotes');
});
test('adversarial NEGATIVE: no bare unquoted $( outside single-quoted span for $(whoami) input', () => {
  const snippet = bdBoundedContext('$(whoami)');
  // Remove all single-quoted spans and verify no $( remains
  const stripped = snippet.replace(/'([^']|\\')*'/g, 'SQSPAN');
  assert.ok(!stripped.includes('$('), 'bare $( must not appear outside a single-quoted span');
});
test('adversarial: integer injection in nSame/nCross — only integer emitted, no injected command', () => {
  const snippet = bdBoundedContext('x', { nSame: '5; rm -rf /', nCross: 3 });
  // The injected string must become integer 5 (lim clamps correctly)
  assert.ok(snippet.includes('--limit 5'), 'lim must extract integer 5 from injection string');
  assert.ok(!snippet.includes('rm -rf'), 'injected command must not appear in snippet');
});
test('adversarial: lim ceiling clamp — 150 becomes 100', () => {
  const snippet = bdBoundedContext('k', { nSame: 150, nCross: 3 });
  assert.ok(snippet.includes('--limit 100'), 'lim(150) must clamp to 100');
  assert.ok(!snippet.includes('--limit 150'), '150 must not appear (ceiling clamp)');
});
test('adversarial: lim octal — "010" parses as 10 not 8', () => {
  const snippet = bdBoundedContext('k', { nSame: '010', nCross: 3 });
  assert.ok(snippet.includes('--limit 10'), 'lim("010") must produce 10 (radix 10, no octal)');
});
test('adversarial: bdRemember failure reason stays JSON-valid for key with double-quote/backslash/single-quote', () => {
  // Key with special chars: double-quote, backslash, single-quote
  const key = 'key"with\\backslash\'quote';
  const snippet = bdRemember('some insight', key);
  // Extract the failure status JSON: find the shq-wrapped JSON in the echo fail branch
  // The failure JSON must contain the key in the reason and must be valid JSON after POSIX de-quote
  // Verify: the snippet contains a single-quote-wrapped JSON string for failure
  const failMatch = snippet.match(/echo ('(?:[^']|'\\'')*')\s*$/);
  assert.ok(failMatch, 'fail echo status line must be present');
  // De-quote the POSIX single-quoted string to get the raw JSON
  const raw = failMatch[1].slice(1, -1).replace(/'\\'' /g, "'").replace(/'\\''(?!')/g, "'");
  // Must be parseable as JSON
  let parsed;
  try {
    // Use a simpler extraction: the JSON payload between the outer single quotes (with '\'' -> ')
    const jsonStr = failMatch[1].slice(1, -1).replace(/'\\''|'\\\\''(?=')|\\'(?=')/g, "'");
    parsed = JSON.parse(failMatch[1].slice(1, -1).replace(/'\\''/g, "'"));
  } catch {
    // Try alternate: the raw content without the outer quotes
    const inner = failMatch[1].slice(1, -1).replace(/'\\''/g, "'");
    try { parsed = JSON.parse(inner); } catch { parsed = null; }
  }
  assert.ok(parsed !== null, 'failure status must be valid JSON after POSIX de-quote');
  assert.equal(parsed.ok, false, 'ok field must be false');
  assert.ok(parsed.reason.includes('bd remember failed for key'), 'reason must include key anchor');
});
test('adversarial: bdRemember with backtick insight — backtick is single-quote wrapped', () => {
  const snippet = bdRemember('`id`');
  // backtick must appear inside single quotes only
  assert.ok(snippet.includes("'`id`'"), 'backtick must be inside single quotes');
  // No bare backtick outside a single-quoted span
  const stripped = snippet.replace(/'[^']*'/g, 'SQSPAN');
  assert.ok(!stripped.includes('`'), 'bare backtick must not appear outside a single-quoted span');
});
