import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { and, eq, sql } from 'drizzle-orm';
import {
  createDbClient, surveyCycleScoringPolicies, surveyQuestions, surveyScoringPolicies,
  surveyWindowScoringPolicies, surveyWindows,
} from '@entalent/database';
import { hasCompleteV2ScoringPolicy } from '@entalent/application';

export interface ActivateV2ScoringPolicyConfig {
  databaseUrl: string;
  tenantId: string;
  surveyDefinitionId: string;
  periodStart: Date;
  periodEnd: Date;
  policyVersion: string;
  approvedAt: Date;
  rubricsFile: string;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OFFSET_INSTANT_PATTERN = /T.*(?:Z|[+-]\d{2}:\d{2})$/;

export function parseActivateV2ScoringPolicyConfig(env: NodeJS.ProcessEnv): ActivateV2ScoringPolicyConfig {
  const databaseUrl = required(env, 'DATABASE_URL');
  const tenantId = required(env, 'TENANT_ID');
  const surveyDefinitionId = required(env, 'SURVEY_DEFINITION_ID');
  if (!UUID_PATTERN.test(tenantId) || !UUID_PATTERN.test(surveyDefinitionId)) {
    throw new Error('TENANT_ID and SURVEY_DEFINITION_ID must be UUIDs');
  }
  if (env['CONFIRM_V2_POLICY_ACTIVATION'] !== tenantId) {
    throw new Error('CONFIRM_V2_POLICY_ACTIVATION must exactly match TENANT_ID');
  }
  const periodStart = parseInstant(required(env, 'SURVEY_PERIOD_START'), 'SURVEY_PERIOD_START');
  const periodEnd = parseInstant(required(env, 'SURVEY_PERIOD_END'), 'SURVEY_PERIOD_END');
  const approvedAt = parseInstant(required(env, 'SCORING_POLICY_APPROVED_AT'), 'SCORING_POLICY_APPROVED_AT');
  if (periodEnd <= periodStart || periodStart <= new Date()) {
    throw new Error('V2 scoring policy activation requires a future, nonempty Pulse Cycle');
  }
  if (approvedAt > new Date()) throw new Error('SCORING_POLICY_APPROVED_AT cannot be in the future');
  return {
    databaseUrl, tenantId, surveyDefinitionId, periodStart, periodEnd, approvedAt,
    policyVersion: required(env, 'SCORING_POLICY_VERSION'),
    rubricsFile: resolve(required(env, 'SCORING_RUBRICS_FILE')),
  };
}

export async function activateV2ScoringPolicy(config: ActivateV2ScoringPolicyConfig): Promise<{
  policyId: string;
  cycleId: string;
  status: 'activated' | 'already_active';
  boundWindowCount: number;
  rubricsSha256: string;
}> {
  const raw = await readFile(config.rubricsFile, 'utf8');
  const rubrics: unknown = JSON.parse(raw);
  const rubricsSha256 = createHash('sha256').update(raw).digest('hex');
  const client = createDbClient(config.databaseUrl);
  try {
    const result = await client.db.transaction(async (tx) => {
      const questions = await tx.select({
        stableKey: surveyQuestions.stableKey,
        responseType: surveyQuestions.responseType,
        questionGroup: surveyQuestions.questionGroup,
      }).from(surveyQuestions).where(eq(surveyQuestions.surveyDefinitionId, config.surveyDefinitionId));
      if (!hasCompleteV2ScoringPolicy(questions, rubrics)) {
        throw new Error('approved_question_rubrics_incomplete');
      }
      const [existingPolicy] = await tx.select().from(surveyScoringPolicies).where(and(
        eq(surveyScoringPolicies.tenantId, config.tenantId),
        eq(surveyScoringPolicies.version, config.policyVersion),
      )).limit(1);
      if (existingPolicy && !isDeepStrictEqual(existingPolicy.rubrics, rubrics)) {
        throw new Error('scoring_policy_version_content_mismatch');
      }
      const policy = existingPolicy ?? (await tx.insert(surveyScoringPolicies).values({
        tenantId: config.tenantId, version: config.policyVersion,
        rubrics, approvedAt: config.approvedAt,
      }).returning())[0]!;
      const cycleScope = and(
        eq(surveyCycleScoringPolicies.tenantId, config.tenantId),
        eq(surveyCycleScoringPolicies.surveyDefinitionId, config.surveyDefinitionId),
        eq(surveyCycleScoringPolicies.periodStart, config.periodStart),
        eq(surveyCycleScoringPolicies.periodEnd, config.periodEnd),
      );
      const [existingCycle] = await tx.select().from(surveyCycleScoringPolicies)
        .where(cycleScope).limit(1);
      if (existingCycle && existingCycle.scoringPolicyId !== policy.id) {
        throw new Error('cycle_scoring_policy_conflict');
      }
      const cycle = existingCycle ?? (await tx.insert(surveyCycleScoringPolicies).values({
        tenantId: config.tenantId, surveyDefinitionId: config.surveyDefinitionId,
        periodStart: config.periodStart, periodEnd: config.periodEnd,
        scoringPolicyId: policy.id,
      }).returning())[0]!;
      return { policyId: policy.id, cycleId: cycle.id,
        status: existingCycle ? 'already_active' as const : 'activated' as const };
    });
    const [count] = await client.db.select({ value: sql<number>`count(*)::int` })
      .from(surveyWindowScoringPolicies)
      .innerJoin(surveyWindows, eq(surveyWindows.id, surveyWindowScoringPolicies.surveyWindowId))
      .where(and(
        eq(surveyWindows.tenantId, config.tenantId),
        eq(surveyWindows.surveyDefinitionId, config.surveyDefinitionId),
        eq(surveyWindows.periodStart, config.periodStart),
        eq(surveyWindows.periodEnd, config.periodEnd),
      ));
    return { ...result, boundWindowCount: count?.value ?? 0, rubricsSha256 };
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
  activateV2ScoringPolicy(parseActivateV2ScoringPolicyConfig(process.env))
    .then((result) => console.log(JSON.stringify(result)))
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : 'V2 scoring policy activation failed');
      process.exitCode = 1;
    });
}
