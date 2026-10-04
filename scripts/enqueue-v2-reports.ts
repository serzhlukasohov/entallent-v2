import IORedis from 'ioredis';
import { Queue } from 'bullmq';
import { and, eq, gt, lte } from 'drizzle-orm';
import { createDbClient, surveyCycleScoringPolicies, surveyReportingCohorts } from '@entalent/database';
import { QUEUE_NAMES } from '../packages/contracts/src/queue';

interface V2ReportJob {
  tenantId: string;
  reportingCohortId: string;
  teamId: string;
  questionGroup: string;
  reportKind: 'intermediate' | 'final';
}

const V2_GROUPS = ['autonomy', 'growth', 'purpose', 'belonging'] as const;
const FINAL_SETTLEMENT_MS = 15 * 60_000;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseV2ReportEnqueueConfig(env: NodeJS.ProcessEnv) {
  const tenantId = env['TENANT_ID']?.trim();
  const databaseUrl = env['DATABASE_URL']?.trim();
  const redisUrl = env['REDIS_URL']?.trim();
  if (!tenantId || !UUID_PATTERN.test(tenantId) || !databaseUrl || !redisUrl) {
    throw new Error('TENANT_ID UUID, DATABASE_URL and REDIS_URL are required');
  }
  const surveyDefinitionId = env['SURVEY_DEFINITION_ID']?.trim();
  if (surveyDefinitionId && !UUID_PATTERN.test(surveyDefinitionId)) {
    throw new Error('SURVEY_DEFINITION_ID must be a UUID');
  }
  const reportKind = env['V2_REPORT_KIND']?.trim();
  if (reportKind !== 'intermediate' && reportKind !== 'final') {
    throw new Error('V2_REPORT_KIND must be intermediate or final');
  }
  return {
    tenantId, databaseUrl, redisUrl, surveyDefinitionId,
    reportKind: reportKind as 'intermediate' | 'final',
    enqueue: env['CONFIRM_V2_REPORT_ENQUEUE'] === tenantId,
    now: new Date(),
  };
}

export async function enqueueV2Reports(config: ReturnType<typeof parseV2ReportEnqueueConfig>) {
  const client = createDbClient(config.databaseUrl);
  const redis = config.enqueue ? new IORedis(config.redisUrl, { maxRetriesPerRequest: null, enableReadyCheck: false }) : null;
  const queue = redis ? new Queue<V2ReportJob>(QUEUE_NAMES.V2_REPORT, { connection: redis }) : null;
  try {
    const rows = await client.db.select({
      tenantId: surveyReportingCohorts.tenantId,
      reportingCohortId: surveyReportingCohorts.id,
      teamId: surveyReportingCohorts.teamId,
    }).from(surveyReportingCohorts).innerJoin(surveyCycleScoringPolicies, and(
      eq(surveyCycleScoringPolicies.tenantId, surveyReportingCohorts.tenantId),
      eq(surveyCycleScoringPolicies.surveyDefinitionId, surveyReportingCohorts.surveyDefinitionId),
      eq(surveyCycleScoringPolicies.periodStart, surveyReportingCohorts.periodStart),
      eq(surveyCycleScoringPolicies.periodEnd, surveyReportingCohorts.periodEnd),
    )).where(and(
      eq(surveyReportingCohorts.tenantId, config.tenantId),
      config.surveyDefinitionId
        ? eq(surveyReportingCohorts.surveyDefinitionId, config.surveyDefinitionId) : undefined,
      config.reportKind === 'final'
        ? lte(surveyReportingCohorts.periodEnd, new Date(config.now.getTime() - FINAL_SETTLEMENT_MS))
        : and(lte(surveyReportingCohorts.periodStart, config.now), gt(surveyReportingCohorts.periodEnd, config.now)),
    ));
    let enqueued = 0;
    for (const row of rows) {
      const groups = config.reportKind === 'final' ? ['cycle'] : V2_GROUPS;
      for (const questionGroup of groups) {
        const payload: V2ReportJob = { ...row, questionGroup, reportKind: config.reportKind };
        if (queue) {
          // A completed ineligible or disabled attempt must not suppress a later run.
          // The database snapshot is the delivery idempotency boundary.
          await queue.add(config.reportKind, payload);
          enqueued++;
        }
      }
    }
    return { tenantId: config.tenantId, reportKind: config.reportKind, candidates: rows.length, enqueued };
  } finally {
    await queue?.close().catch(() => undefined);
    await redis?.quit().catch(() => undefined);
    await client.sql.end({ timeout: 2 }).catch(() => undefined);
  }
}

if (require.main === module) {
  enqueueV2Reports(parseV2ReportEnqueueConfig(process.env))
    .then((result) => console.log(JSON.stringify(result)))
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
}
