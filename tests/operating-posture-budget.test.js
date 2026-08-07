// tests/operating-posture-budget.test.js
// Token-budget guard for the shared operating-posture floor.
// operatingInstructions() is woven into EVERY agent prompt via postureFor()
// (model-tiers.js), so its size is a per-call token tax. This file guards the
// block from bloating. Today it measures 1436 chars / ~359 est tokens, so the
// thresholds below pass with ~25% headroom; the intended trip case is a 5th
// labeled group (~300-400 chars), not minor wording edits.
//
// Authority split: line count lives in posture.test.js:108 (hard cap 16) and
// trailing-whitespace in posture.test.js:112. This file owns the SIZE budget.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { operatingInstructions } from '../src/fragments/operating-posture.js';

const CHAR_BUDGET = 1800;
const EST_TOKEN_BUDGET = 500; // coarse chars/4 proxy for per-call token cost
const GROUP_MARKERS = [/VERIFY BEFORE CLAIM/, /SCOPE & SAFETY/, /JUDGMENT/, /COMMUNICATION/];

test('operatingInstructions() stays within the per-call size budget', () => {
  const b = operatingInstructions();
  assert.ok(
    b.length < CHAR_BUDGET,
    `block is ${b.length} chars (budget ${CHAR_BUDGET}); paid on every agent call`,
  );
  const estTokens = Math.ceil(b.length / 4);
  assert.ok(
    estTokens < EST_TOKEN_BUDGET,
    `block is ~${estTokens} est tokens (budget ${EST_TOKEN_BUDGET}); paid on every agent call`,
  );
});

test('operatingInstructions() retains all 4 group labels', () => {
  const b = operatingInstructions();
  for (const m of GROUP_MARKERS) assert.match(b, m, `missing group label ${m}`);
});
