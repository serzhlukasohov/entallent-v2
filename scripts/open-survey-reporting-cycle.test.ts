import assert from 'node:assert/strict';
import { parseOpenSurveyReportingCycleConfig } from './open-survey-reporting-cycle';

const valid = {
  DATABASE_URL: 'postgresql://example',
  TENANT_ID: '11111111-1111-4111-8111-111111111111',
  SURVEY_DEFINITION_ID: '22222222-2222-4222-8222-222222222222',
  SURVEY_PERIOD_START: '2026-07-01T00:00:00.000Z',
  SURVEY_PERIOD_END: '2026-10-01T00:00:00.000Z',
  SURVEY_OPENED_AT: '2026-07-01T00:00:00.000Z',
  CONFIRM_SURVEY_CYCLE_OPEN: '11111111-1111-4111-8111-111111111111',
};

assert.deepEqual(parseOpenSurveyReportingCycleConfig(valid), {
  databaseUrl: valid.DATABASE_URL,
  tenantId: valid.TENANT_ID,
  surveyDefinitionId: valid.SURVEY_DEFINITION_ID,
  periodStart: new Date(valid.SURVEY_PERIOD_START),
  periodEnd: new Date(valid.SURVEY_PERIOD_END),
  openedAt: new Date(valid.SURVEY_OPENED_AT),
});
assert.throws(
  () => parseOpenSurveyReportingCycleConfig({ ...valid, CONFIRM_SURVEY_CYCLE_OPEN: undefined }),
  /must exactly match TENANT_ID/,
);
assert.throws(
  () => parseOpenSurveyReportingCycleConfig({ ...valid, SURVEY_PERIOD_END: '2026-10-01' }),
  /explicit offset/,
);

console.log('Open survey reporting cycle config tests passed');
