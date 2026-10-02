// tests/run-cost.test.js
// Verifies scripts/run-cost.sh sums tokens by model and applies the pricing
// table correctly, against a synthetic transcript fixture with known usage.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'run-cost.sh');

function mkRun(agents) {
  const dir = mkdtempSync(join(tmpdir(), 'runcost-'));
  agents.forEach((a, i) => {
    writeFileSync(join(dir, `agent-${i}.meta.json`), JSON.stringify({ agentType: a.agentType }));
    const lines = a.msgs.map(m => JSON.stringify({ message: { model: m.model, usage: m.usage } }));
    writeFileSync(join(dir, `agent-${i}.jsonl`), lines.join('\n') + '\n');
  });
  return dir;
}

test('run-cost sums by model and applies pricing', () => {
  // opus: 1M in ($5) + 1M out ($25) = $30 ; sonnet: 1M in ($3) + 1M cache_read ($0.30) = $3.30
  const dir = mkRun([
    { agentType: 'designer', msgs: [{ model: 'claude-opus-4-8', usage: { input_tokens: 1_000_000, output_tokens: 1_000_000 } }] },
    { agentType: 'researcher', msgs: [{ model: 'claude-sonnet-4-6', usage: { input_tokens: 1_000_000, cache_read_input_tokens: 1_000_000 } }] },
  ]);
  try {
    const out = JSON.parse(execFileSync('bash', [SCRIPT, '--json', dir], { encoding: 'utf8' }));
    assert.equal(out.total_usd, 33.30, 'opus $30 + sonnet $3.30');
    assert.ok(Math.abs(out.by_model['claude-opus-4-8'] - 30) < 1e-6);
    assert.ok(Math.abs(out.by_agent['designer'] - 30) < 1e-6);
    assert.equal(out.total_tokens, 4_000_000);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('run-cost prices 5m cache-creation at the write rate', () => {
  // opus cache write 5m = 1.25x input = $6.25/1M ; 1M -> $6.25
  const dir = mkRun([
    { agentType: 'impl', msgs: [{ model: 'claude-opus-4-8', usage: { cache_creation: { ephemeral_5m_input_tokens: 1_000_000, ephemeral_1h_input_tokens: 0 } } }] },
  ]);
  try {
    const out = JSON.parse(execFileSync('bash', [SCRIPT, '--json', dir], { encoding: 'utf8' }));
    assert.equal(out.total_usd, 6.25);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('run-cost flags unknown models (priced at sonnet fallback)', () => {
  const dir = mkRun([{ agentType: 'x', msgs: [{ model: 'gpt-foo', usage: { input_tokens: 1_000_000 } }] }]);
  try {
    const out = JSON.parse(execFileSync('bash', [SCRIPT, '--json', dir], { encoding: 'utf8' }));
    assert.deepEqual(out.unknown_models, ['gpt-foo']);
    assert.equal(out.total_usd, 3.0); // sonnet input rate
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
