import assert from 'node:assert/strict';
import { parseCloseSurveyReportingCycleConfig } from './close-survey-reporting-cycle';

const valid = {
  DATABASE_URL: 'postgresql://example',
  REDIS_URL: 'redis://localhost:6379',
  TENANT_ID: '11111111-1111-4111-8111-111111111111',
  SURVEY_DEFINITION_ID: '22222222-2222-4222-8222-222222222222',
  SURVEY_CYCLE_CLOSE_AT: '2026-10-01T00:00:00.000Z',
};

assert.deepEqual(parseCloseSurveyReportingCycleConfig(valid), {
  databaseUrl: valid.DATABASE_URL,
  redisUrl: valid.REDIS_URL,
  tenantId: valid.TENANT_ID,
  surveyDefinitionId: valid.SURVEY_DEFINITION_ID,
  now: new Date(valid.SURVEY_CYCLE_CLOSE_AT),
});
assert.throws(
  () => parseCloseSurveyReportingCycleConfig({ ...valid, SURVEY_CYCLE_CLOSE_AT: '2026-10-01' }),
  /explicit offset/,
);
assert.throws(
  () => parseCloseSurveyReportingCycleConfig({ ...valid, TENANT_ID: 'tenant-1' }),
  /must be UUIDs/,
);

console.log('Close survey reporting cycle config tests passed');
