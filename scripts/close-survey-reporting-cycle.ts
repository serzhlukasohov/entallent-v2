import IORedis from 'ioredis';
import { Queue } from 'bullmq';
import { createDbClient } from '@entalent/database';
import {
  CloseSurveyReportingCycleUseCase,
  type GroupReportPayload,
} from '@entalent/application';
import { QUEUE_NAMES } from '@entalent/contracts';
import { SurveyRepository } from '../apps/worker/src/survey/repositories/survey.repository';
import { GroupStateRepository } from '../apps/worker/src/survey/repositories/group-state.repository';
import { TeamRepository } from '../apps/worker/src/survey/repositories/team.repository';

export interface CloseSurveyReportingCycleConfig {
  databaseUrl: string;
  redisUrl: string;
  tenantId: string;
  surveyDefinitionId?: string;
  now: Date;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OFFSET_INSTANT_PATTERN = /T.*(?:Z|[+-]\d{2}:\d{2})$/;

export function parseCloseSurveyReportingCycleConfig(
  env: NodeJS.ProcessEnv,
): CloseSurveyReportingCycleConfig {
  const tenantId = required(env, 'TENANT_ID');
  const surveyDefinitionId = env['SURVEY_DEFINITION_ID']?.trim() || undefined;
  if (!UUID_PATTERN.test(tenantId) || (surveyDefinitionId && !UUID_PATTERN.test(surveyDefinitionId))) {
    throw new Error('TENANT_ID and SURVEY_DEFINITION_ID must be UUIDs');
  }
  return {
    databaseUrl: required(env, 'DATABASE_URL'),
    redisUrl: required(env, 'REDIS_URL'),
    tenantId,
    ...(surveyDefinitionId ? { surveyDefinitionId } : {}),
    now: parseInstant(env['SURVEY_CYCLE_CLOSE_AT']?.trim() || new Date().toISOString(), 'SURVEY_CYCLE_CLOSE_AT'),
  };
}

async function main(): Promise<void> {
  const config = parseCloseSurveyReportingCycleConfig(process.env);
  const client = createDbClient(config.databaseUrl);
  const redis = createRedis(config.redisUrl);
  const groupReportQueue = new Queue<GroupReportPayload>(QUEUE_NAMES.GROUP_REPORT, { connection: redis });
  try {
    const repository = new SurveyRepository(
      { client: client.db } as never,
      new GroupStateRepository({ client: client.db } as never),
      new TeamRepository({ client: client.db } as never),
    );
    const useCase = new CloseSurveyReportingCycleUseCase(repository, {
      enqueueGroupReport: (payload) => groupReportQueue.add('report', payload).then(() => undefined),
    });
    const result = await useCase.execute({
      tenantId: config.tenantId,
      ...(config.surveyDefinitionId ? { surveyDefinitionId: config.surveyDefinitionId } : {}),
      now: config.now,
    });
    console.log(JSON.stringify({
      tenantId: config.tenantId,
      surveyDefinitionId: config.surveyDefinitionId ?? null,
      closedAt: config.now.toISOString(),
      ...result,
    }, null, 2));
  } finally {
    await groupReportQueue.close().catch(() => undefined);
    await redis.quit().catch(() => undefined);
    await client.sql.end({ timeout: 2 }).catch(() => undefined);
  }
}

function createRedis(redisUrl: string): IORedis {
  const parsed = new URL(redisUrl);
  return new IORedis({
    host: parsed.hostname,
    port: Number(parsed.port) || 6379,
    ...(parsed.password ? { password: decodeURIComponent(parsed.password) } : {}),
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
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
