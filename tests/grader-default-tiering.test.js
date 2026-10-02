// tests/grader-default-tiering.test.js
// Guards the default verdict tiering in grader.md so rubrics that lack an
// explicit '## Verdict mapping' section inherit severity-tiered behavior
// (BLOCK only on P0/non-negotiable, REQUEST_CHANGES on core gaps, APPROVE
// with advisory criteria in gaps_for_agent) rather than the over-strict
// 'all criteria must pass' fallback.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const SRC = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '.claude/agents/grader.md'), 'utf8');

test('grader.md contains a Default verdict tiering section', () => {
  assert.match(SRC, /## Default verdict tiering/);
});

test('default tiering uses BLOCK / REQUEST_CHANGES / APPROVE language', () => {
  assert.match(SRC, /\bBLOCK\b/);
  assert.match(SRC, /\bREQUEST_CHANGES\b/);
  assert.match(SRC, /\bAPPROVE\b/);
});

test('default tiering restricts BLOCK to P0/non-negotiable/hard-gate criteria', () => {
  assert.match(SRC, /BLOCK\b.*(?:P0|non-negotiable|hard-gate|blocking)/s);
});

test('default tiering directs advisory criteria to gaps_for_agent, not verdict downgrade', () => {
  assert.match(SRC, /advisory/i);
  assert.match(SRC, /gaps_for_agent/);
});

test('default tiering says not-all-criteria-passed does not block a sound artifact', () => {
  assert.match(SRC, /not all criteria passed/i);
});

test('per-rubric Verdict mapping overrides the default', () => {
  assert.match(SRC, /per-rubric.*override|overrides this default/i);
});
