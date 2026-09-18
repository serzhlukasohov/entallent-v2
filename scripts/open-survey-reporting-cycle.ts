import { createDbClient } from '@entalent/database';
import { OpenSurveyReportingCycleUseCase } from '@entalent/application';
import { SurveyRepository } from '../apps/worker/src/survey/repositories/survey.repository';

export interface OpenSurveyReportingCycleConfig {
  databaseUrl: string;
  tenantId: string;
  surveyDefinitionId: string;
  periodStart: Date;
  periodEnd: Date;
  openedAt: Date;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OFFSET_INSTANT_PATTERN = /T.*(?:Z|[+-]\d{2}:\d{2})$/;

export function parseOpenSurveyReportingCycleConfig(
  env: NodeJS.ProcessEnv,
): OpenSurveyReportingCycleConfig {
  const databaseUrl = required(env, 'DATABASE_URL');
  const tenantId = required(env, 'TENANT_ID');
  const surveyDefinitionId = required(env, 'SURVEY_DEFINITION_ID');
  if (!UUID_PATTERN.test(tenantId) || !UUID_PATTERN.test(surveyDefinitionId)) {
    throw new Error('TENANT_ID and SURVEY_DEFINITION_ID must be UUIDs');
  }
  if (env['CONFIRM_SURVEY_CYCLE_OPEN'] !== tenantId) {
    throw new Error('CONFIRM_SURVEY_CYCLE_OPEN must exactly match TENANT_ID');
  }
  return {
    databaseUrl,
    tenantId,
    surveyDefinitionId,
    periodStart: parseInstant(required(env, 'SURVEY_PERIOD_START'), 'SURVEY_PERIOD_START'),
    periodEnd: parseInstant(required(env, 'SURVEY_PERIOD_END'), 'SURVEY_PERIOD_END'),
    openedAt: parseInstant(required(env, 'SURVEY_OPENED_AT'), 'SURVEY_OPENED_AT'),
  };
}

async function main(): Promise<void> {
  const config = parseOpenSurveyReportingCycleConfig(process.env);
  const client = createDbClient(config.databaseUrl);
  try {
    const repository = new SurveyRepository(
      { client: client.db } as never,
      {} as never,
      {} as never,
    );
    const useCase = new OpenSurveyReportingCycleUseCase(repository);
    const cohorts = await useCase.execute(config);
    console.log(JSON.stringify({
      tenantId: config.tenantId,
      surveyDefinitionId: config.surveyDefinitionId,
      periodStart: config.periodStart.toISOString(),
      periodEnd: config.periodEnd.toISOString(),
      cohorts: cohorts.map((cohort) => ({
        id: cohort.id,
        teamId: cohort.teamId,
        rosterSize: cohort.rosterUserIds.length,
        openedAt: cohort.openedAt.toISOString(),
      })),
    }, null, 2));
  } finally {
    await client.sql.end({ timeout: 2 }).catch(() => undefined);
  }
}

function required(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key]?.trim();
  if (!value) throw new Error(`${key} is required`);
  return value;
}

function parseInstant(value: string, key: string): Date {
  if (!OFFSET_INSTANT_PATTERN.test(value)) {
    throw new Error(`${key} must be an ISO-8601 instant with an explicit offset`);
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new Error(`${key} must be a valid instant`);
  return parsed;
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
