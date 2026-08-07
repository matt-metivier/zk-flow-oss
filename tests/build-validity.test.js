// tests/build-validity.test.js
// Verifies that every src/workflows/*.src.js (non-_-prefixed) builds to a valid
// self-contained workflow: contains `export const meta`, has no leftover
// // @@FRAGMENTS@@ marker, has no import lines, and parses without throwing.
// This replaces build-drift.test.js — .claude/workflows/*.js are now generated
// (gitignored) and not committed, so drift comparison is moot.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildWorkflow, fragmentsFor } from '../build.js';

const ROOT = dirname(fileURLToPath(import.meta.url));
const REPO = join(ROOT, '..');

test('every src workflow builds to a valid self-contained output', () => {
  const srcFiles = readdirSync(join(REPO, 'src/workflows'))
    .filter(f => f.endsWith('.src.js') && !f.startsWith('_'));

  assert.ok(srcFiles.length > 0, 'expected at least one src workflow');

  const failures = [];
  for (const file of srcFiles) {
    const name = file.replace('.src.js', '');
    let out;
    try {
      out = buildWorkflow(name, fragmentsFor(name));
    } catch (e) {
      failures.push(`${name}: buildWorkflow threw: ${e.message}`);
      continue;
    }

    // (a) must contain export const meta
    if (!out.includes('export const meta')) {
      failures.push(`${name}: missing 'export const meta'`);
    }
    // (b) must have no leftover @@FRAGMENTS@@ marker
    if (out.includes('// @@FRAGMENTS@@')) {
      failures.push(`${name}: leftover // @@FRAGMENTS@@ marker`);
    }
    // (c) must have no import lines (workflow sandbox has no import support)
    if (/^import\s/m.test(out)) {
      failures.push(`${name}: contains import line (fragments must not import)`);
    }
    // (d) must parse (strip leading 'export' keywords, wrap in async fn, new Function)
    try {
      const stripped = out.replace(/^export\s+/gm, '');
      // eslint-disable-next-line no-new-func
      new Function('return (async () => { ' + stripped + ' })');
    } catch (e) {
      failures.push(`${name}: parse error: ${e.message}`);
    }
  }

  assert.deepEqual(failures, [], `Build validity failures:\n${failures.join('\n')}`);
});

test('meta.phases matches the phase() calls in every workflow', () => {
  // feature declared 'Impl', investigate 'Hypotheses' and remember 'Resume' without ever
  // calling phase() for them — inert groups in the progress UI. build.js now throws, so
  // this asserts the check is live rather than re-deriving it.
  const names = readdirSync(join(REPO, 'src/workflows'))
    .filter(f => f.endsWith('.src.js') && !f.startsWith('_'))
    .map(f => f.replace('.src.js', ''));
  for (const name of names) {
    const body = readFileSync(join(REPO, 'src/workflows', `${name}.src.js`), 'utf8');
    const declared = new Set([...body.matchAll(/title:\s*'([^']+)'/g)].map(m => m[1]));
    const called = new Set([...body.matchAll(/\bphase\('([^']+)'\)/g)].map(m => m[1]));
    assert.deepEqual([...declared].filter(p => !called.has(p)), [], `${name}: declared but never called`);
    assert.deepEqual([...called].filter(p => !declared.has(p)), [], `${name}: called but not declared`);
  }
});

test('the plugin manifest points at paths that exist', () => {
  // The manifest reuses the existing layout instead of a parallel plugin tree, so a
  // moved directory silently produces a plugin with no commands or no workflows.
  const manifest = JSON.parse(readFileSync(join(REPO, '.claude-plugin/plugin.json'), 'utf8'));
  assert.equal(manifest.name, 'zk-flow');
  for (const field of ['commands', 'workflows']) {
    for (const rel of manifest[field]) {
      assert.ok(existsSync(join(REPO, rel)), `${field} path missing: ${rel}`);
    }
  }
  // `agents` must NOT be a manifest field — that field rejects a directory, which is why
  // agents/ is a symlink into .claude/agents instead.
  assert.equal(manifest.agents, undefined, 'agents ships via the agents/ symlink, not the manifest');
  assert.ok(existsSync(join(REPO, 'agents')), 'agents/ symlink present');
});

test('every agent file has parseable YAML frontmatter', () => {
  // claude plugin validate caught proposal-verifier.md loading with ALL frontmatter
  // silently dropped: an unquoted "Rejects on: ..." colon-space broke the block, so the
  // agent ran with no model pin and no tools restriction.
  for (const f of readdirSync(join(REPO, '.claude/agents')).filter(x => x.endsWith('.md'))) {
    const lines = readFileSync(join(REPO, '.claude/agents', f), 'utf8').split('\n');
    assert.equal(lines[0], '---', `${f}: starts with frontmatter`);
    const end = lines.indexOf('---', 1);
    assert.ok(end > 1, `${f}: frontmatter is closed`);
    for (const line of lines.slice(1, end)) {
      const m = /^(\w[\w-]*):\s*(.+)$/.exec(line);
      if (!m) continue;
      const val = m[2];
      const quoted = /^["'[]/.test(val);
      assert.ok(quoted || !val.includes(': '),
        `${f}: '${m[1]}' has an unquoted colon-space — YAML drops the whole block`);
    }
  }
});

test('the marketplace always ships zk-flow, and any private entry is stripped when published', () => {
  // This suite also runs INSIDE the sanitized snapshot during sync-oss (that is the gate
  // that decides whether the mirror publishes). There, sync-oss.sh itself is excluded and
  // the private zkengine entry has already been filtered out — so asserting "both entries
  // exist" fails in exactly the context where a failure blocks publishing. It did: the
  // mirror sat 1 commit stale because this test threw ENOENT on the excluded script.
  const mk = JSON.parse(readFileSync(join(REPO, '.claude-plugin/marketplace.json'), 'utf8'));
  const zkflow = mk.plugins.find(p => p.name === 'zk-flow');
  assert.ok(zkflow, 'zk-flow is listed in every context');
  assert.equal(zkflow.source, '.', 'zk-flow ships from the marketplace root');

  const zkengine = mk.plugins.find(p => p.name === 'zkengine');
  const syncPath = join(REPO, 'scripts/sync-oss.sh');
  if (!existsSync(syncPath)) {
    // Sanitized snapshot: the private entry MUST already be gone.
    assert.equal(zkengine, undefined, 'a published catalog must not list a private-source plugin');
    return;
  }
  // Private repo: both entries present, and the sync must strip the private one.
  assert.ok(zkengine, 'private catalog lists the skills plugin');
  assert.equal(typeof zkengine.source, 'object', 'zkengine resolves to a separate repo');
  assert.match(readFileSync(syncPath, 'utf8'), /private-source entries removed/,
    'sync strips private entries before publishing');
});

test('plugin hooks use CLAUDE_PLUGIN_ROOT and project settings keep only machine-specific ones', () => {
  const hooks = JSON.parse(readFileSync(join(REPO, 'hooks/hooks.json'), 'utf8'));
  const blob = JSON.stringify(hooks);
  assert.ok(!/ZK_FLOW_DIR/.test(blob),
    'no $ZK_FLOW_DIR in plugin hooks — that path does not exist on a machine that installed the plugin without cloning');
  assert.match(blob, /CLAUDE_PLUGIN_ROOT/, 'script paths resolve inside the plugin');
  for (const evt of ['Stop', 'SessionStart', 'PreCompact', 'PreToolUse', 'PostToolUse']) {
    assert.ok(hooks[evt], `plugin ships the ${evt} engine hook`);
  }
  // Duplicates across plugin + project settings double-fire every Stop and SessionStart.
  const settings = JSON.parse(readFileSync(join(REPO, '.claude/settings.json'), 'utf8'));
  for (const evt of ['Stop', 'SessionStart', 'PreCompact', 'PreToolUse', 'PostToolUse']) {
    assert.equal(settings.hooks[evt], undefined,
      `${evt} must not be duplicated in project settings — the plugin ships it`);
  }
  assert.ok(settings.hooks.UserPromptSubmit, 'the machine-specific hook stays in project settings');
});

test('onboard installs plugins with an explicit scope', () => {
  // Omitting --scope makes the CLI prompt for one; a non-interactive onboard then hangs.
  const onboard = readFileSync(join(REPO, 'scripts/onboard.sh'), 'utf8');
  assert.match(onboard, /plugin marketplace add "\$ZK_FLOW_DIR" --scope user/);
  assert.match(onboard, /plugin install "\$\{plug\}@zk-flow-marketplace" --scope user/);
  assert.match(onboard, /will fire TWICE/, 'onboard warns about duplicated engine hooks');
});
