import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { parseActivateV2ScoringPolicyConfig } from './activate-v2-scoring-policy';

const valid = {
  DATABASE_URL: 'postgresql://example',
  TENANT_ID: '11111111-1111-4111-8111-111111111111',
  SURVEY_DEFINITION_ID: '22222222-2222-4222-8222-222222222222',
  SURVEY_PERIOD_START: '2030-01-01T00:00:00Z',
  SURVEY_PERIOD_END: '2030-04-01T00:00:00Z',
  SCORING_POLICY_VERSION: 'approved-v1',
  SCORING_POLICY_APPROVED_AT: '2026-09-28T00:00:00Z',
  SCORING_RUBRICS_FILE: 'fixtures/approved-rubrics.json',
  CONFIRM_V2_POLICY_ACTIVATION: '11111111-1111-4111-8111-111111111111',
};

assert.deepEqual(parseActivateV2ScoringPolicyConfig(valid), {
  databaseUrl: valid.DATABASE_URL,
  tenantId: valid.TENANT_ID,
  surveyDefinitionId: valid.SURVEY_DEFINITION_ID,
  periodStart: new Date(valid.SURVEY_PERIOD_START),
  periodEnd: new Date(valid.SURVEY_PERIOD_END),
  policyVersion: valid.SCORING_POLICY_VERSION,
  approvedAt: new Date(valid.SCORING_POLICY_APPROVED_AT),
  rubricsFile: resolve(valid.SCORING_RUBRICS_FILE),
});
assert.throws(
  () => parseActivateV2ScoringPolicyConfig({ ...valid, CONFIRM_V2_POLICY_ACTIVATION: undefined }),
  /must exactly match TENANT_ID/,
);
assert.throws(
  () => parseActivateV2ScoringPolicyConfig({ ...valid,
    SURVEY_PERIOD_START: '2026-01-01T00:00:00Z', SURVEY_PERIOD_END: '2026-04-01T00:00:00Z',
  }),
  /unfinished, nonempty Pulse Cycle/,
);
const started = new Date(Date.now() - 86_400_000).toISOString();
const unfinished = new Date(Date.now() + 86_400_000).toISOString();
assert.equal(parseActivateV2ScoringPolicyConfig({ ...valid,
  SURVEY_PERIOD_START: started, SURVEY_PERIOD_END: unfinished,
}).periodStart.toISOString(), started);
assert.throws(
  () => parseActivateV2ScoringPolicyConfig({ ...valid,
    SURVEY_PERIOD_START: new Date(Date.now() - 172_800_000).toISOString(),
    SURVEY_PERIOD_END: started,
  }),
  /unfinished, nonempty Pulse Cycle/,
);
assert.throws(
  () => parseActivateV2ScoringPolicyConfig({ ...valid, SCORING_POLICY_APPROVED_AT: '2031-01-01T00:00:00Z' }),
  /cannot be in the future/,
);

console.log('V2 scoring policy activation config tests passed');
