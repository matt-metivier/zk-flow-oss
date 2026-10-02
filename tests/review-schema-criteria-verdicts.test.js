// tests/review-schema-criteria-verdicts.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SCHEMAS } from '../src/fragments/schemas.js';

function requiredFieldsArePresent(schema, value) {
  return schema.required.every(field => Object.hasOwn(value, field));
}

const baseReviewOutput = {
  verdict: 'APPROVE',
  evidence_quality: 'strong',
  weighted_score: 1,
  findings: [],
};

test('review schema keeps criteria_verdicts optional for existing outputs', () => {
  assert.equal(requiredFieldsArePresent(SCHEMAS.review, baseReviewOutput), true);
  assert.doesNotMatch(SCHEMAS.review.required.join(','), /criteria_verdicts/);
});

test('review schema accepts typed criteria_verdicts when present', () => {
  const output = {
    ...baseReviewOutput,
    criteria_verdicts: [
      { id: 'review-1', name: 'No correctness bugs', passed: true, evidence: 'No P0 findings.' },
      { id: 'review-4', name: 'Positive patterns identified', passed: false, evidence: 'No strengths cited.', gap: 'Add one concrete strength.' },
    ],
  };

  assert.equal(requiredFieldsArePresent(SCHEMAS.review, output), true);
  const criteria = SCHEMAS.review.properties.criteria_verdicts;
  assert.equal(criteria.type, 'array');
  assert.deepEqual(criteria.items.required, ['id', 'name', 'passed', 'evidence']);
  assert.equal(criteria.items.properties.gap.type, 'string');
});
