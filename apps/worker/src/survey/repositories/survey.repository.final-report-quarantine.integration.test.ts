import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { CloseSurveyReportingCycleUseCase } from '@entalent/application';
import { SurveyRepository } from './survey.repository';

const databaseUrl = process.env['DATABASE_URL'];
const TENANT = '11111111-1111-4111-8111-111111111111';
const OTHER_TENANT = '22222222-2222-4222-8222-222222222222';
const DEFINITION = '33333333-3333-4333-8333-333333333333';
const V1_COHORT = '44444444-4444-4444-8444-444444444444';
const V2_COHORT = '55555555-5555-4555-8555-555555555555';
const FOREIGN_COHORT = '66666666-6666-4666-8666-666666666666';
const V2_WINDOW = '77777777-7777-4777-8777-777777777777';
const EMPTY_V2_COHORT = '88888888-8888-4888-8888-888888888888';
const OLD_V1_COHORT = '99999999-9999-4999-8999-999999999999';

describe.runIf(Boolean(databaseUrl))('final report V1/V2 cohort quarantine on PostgreSQL', () => {
  const client = databaseUrl ? postgres(databaseUrl, { max: 1 }) : null;
  const repository = client
    ? new SurveyRepository({ client: drizzle(client) } as never, {} as never, {} as never)
    : null;

  beforeAll(async () => {
    if (!client) return;
    await client`create temp table survey_reporting_cohorts (
      id uuid primary key, tenant_id uuid not null, team_id uuid not null,
      survey_definition_id uuid not null, period_start timestamptz not null,
      period_end timestamptz not null, roster_user_ids uuid[] not null,
      opened_at timestamptz not null
    )`;
    await client`create temp table survey_windows (
      id uuid primary key, tenant_id uuid not null, user_id uuid not null,
      reporting_cohort_id uuid, period_end timestamptz not null
    )`;
    await client`create temp table survey_window_scoring_policies (
      survey_window_id uuid primary key, tenant_id uuid not null
    )`;
    await client`create temp table survey_cycle_scoring_policies (
      tenant_id uuid not null, survey_definition_id uuid not null,
      period_start timestamptz not null, period_end timestamptz not null
    )`;
    await client`insert into survey_reporting_cohorts values
      (${V1_COHORT}, ${TENANT}, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', ${DEFINITION},
        '2026-07-01T00:00:00Z', '2026-10-01T00:00:00Z', array[]::uuid[], '2026-07-01T00:00:00Z'),
      (${V2_COHORT}, ${TENANT}, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', ${DEFINITION},
        '2026-07-01T00:00:00Z', '2026-10-01T00:00:00Z', array[]::uuid[], '2026-07-01T00:00:00Z'),
      (${FOREIGN_COHORT}, ${OTHER_TENANT}, 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', ${DEFINITION},
        '2026-07-01T00:00:00Z', '2026-10-01T00:00:00Z', array[]::uuid[], '2026-07-01T00:00:00Z'),
      (${EMPTY_V2_COHORT}, ${TENANT}, 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', ${DEFINITION},
        '2026-07-01T00:00:00Z', '2026-10-01T00:00:00Z', array[]::uuid[], '2026-07-01T00:00:00Z'),
      (${OLD_V1_COHORT}, ${TENANT}, 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', ${DEFINITION},
        '2026-04-01T00:00:00Z', '2026-07-01T00:00:00Z', array[]::uuid[], '2026-04-01T00:00:00Z')`;
    await client`insert into survey_windows values
      (${V2_WINDOW}, ${TENANT}, 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        ${V2_COHORT}, '2026-10-01T00:00:00Z')`;
  });

  afterAll(async () => client?.end());

  it('withholds an entire V2-bound cohort from V1 final report jobs', async () => {
    if (!client || !repository) return;
    const input = { tenantId: TENANT, surveyDefinitionId: DEFINITION,
      now: new Date('2026-10-02T00:00:00Z') };
    expect((await repository.findReportingCohortsReadyForFinalReports(input)).map((row) => row.id))
      .toEqual([V1_COHORT, V2_COHORT, EMPTY_V2_COHORT, OLD_V1_COHORT]);

    await client`insert into survey_window_scoring_policies values (${V2_WINDOW}, ${TENANT})`;
    expect((await repository.findReportingCohortsReadyForFinalReports(input)).map((row) => row.id))
      .toEqual([V1_COHORT, EMPTY_V2_COHORT, OLD_V1_COHORT]);
    await client`insert into survey_cycle_scoring_policies values
      (${TENANT}, ${DEFINITION}, '2026-07-01T00:00:00Z', '2026-10-01T00:00:00Z')`;
    expect((await repository.findReportingCohortsReadyForFinalReports(input)).map((row) => row.id))
      .toEqual([OLD_V1_COHORT]);
    const queuedCohortIds: string[] = [];
    const close = new CloseSurveyReportingCycleUseCase({
      findReportingCohortsReadyForFinalReports: repository.findReportingCohortsReadyForFinalReports.bind(repository),
      expireTemporaryGroupStatesForClosedCohorts: async () => 0,
      expireTemporaryQuestionInsightsForClosedWindows: async () => 0,
    } as never, {
      enqueueGroupReport: async (job: { reportingCohortId: string }) => {
        queuedCohortIds.push(job.reportingCohortId);
      },
    } as never);
    expect((await close.execute(input)).queuedReportCount).toBe(1);
    expect(queuedCohortIds).toEqual([OLD_V1_COHORT]);
    expect(await repository.findReportingCohortsReadyForFinalReports({
      ...input, now: new Date('2026-03-31T00:00:00Z'),
    })).toEqual([]);
  });
});
