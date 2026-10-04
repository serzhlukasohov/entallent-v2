import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import {
  surveyCycleScoringPolicies, surveyDefinitions, surveyQuestionInsights, surveyQuestions,
  surveyReportingCohorts, surveyScoringPolicies, surveyWindows,
  teams, tenants, users,
} from '@entalent/database';
import { selectV2CohortReportInputs, V2_QUESTION_GROUP_BY_STABLE_KEY } from '@entalent/application';
import { V2CohortReportInputRepository } from './v2-cohort-report-input.repository';

const databaseUrl = process.env['DATABASE_URL'];
describe.runIf(Boolean(databaseUrl))('V2 frozen cohort input reader on migrated PostgreSQL', () => {
  const client = databaseUrl ? postgres(databaseUrl, { max: 1 }) : null;
  const db = client ? drizzle(client) : null;
  const reader = db ? new V2CohortReportInputRepository({ client: db } as never) : null;
  let tenantId: string | null = null;

  beforeAll(async () => {
    if (!client) return;
    const [row] = await client`select to_regclass('public.survey_cycle_scoring_policies') as table_name`;
    if (!row?.['table_name']) throw new Error('v2_migrated_schema_required');
  });
  afterAll(async () => {
    if (db && tenantId) await db.delete(tenants).where(eq(tenants.id, tenantId));
    await client?.end();
  });

  it('reads five bound roster windows and excludes withdrawn insights', async () => {
    if (!db || !reader) return;
    const [tenant] = await db.insert(tenants).values({ name: `V2 cohort fixture ${randomUUID()}` }).returning();
    tenantId = tenant!.id;
    const [team] = await db.insert(teams).values({ tenantId, name: 'Synthetic team' }).returning();
    const roster = await db.insert(users).values(Array.from({ length: 5 }, () => ({ tenantId: tenantId! }))).returning();
    const rosterUserIds = roster.map((row) => row.id);
    const [definition] = await db.insert(surveyDefinitions).values({ tenantId, name: 'Synthetic V2', version: 'v2-policy-1.0.0' }).returning();
    const questions = await db.insert(surveyQuestions).values(
      Object.entries(V2_QUESTION_GROUP_BY_STABLE_KEY).map(([stableKey, questionGroup], i) => ({
        surveyDefinitionId: definition!.id, stableKey, title: stableKey, canonicalMeaning: stableKey,
        dimension: questionGroup, questionGroup, displayOrder: i, version: '1',
      })),
    ).returning();
    const selectedQuestions = questions.filter((question) => question.questionGroup === 'autonomy');
    const rubrics = Object.fromEntries(questions.map((question) => [question.stableKey, {
      version: 'fixture-v1', instructions: 'Synthetic fixture only.',
      anchors: [{ score: 0, description: 'Low' }, { score: 100, description: 'High' }],
    }]));
    const [policy] = await db.insert(surveyScoringPolicies).values({
      tenantId, version: 'fixture-v1', rubrics, approvedAt: new Date(),
    }).returning();
    const periodStart = new Date(Date.now() + 86_400_000);
    const periodEnd = new Date(periodStart.getTime() + 31 * 86_400_000);
    const [cohort] = await db.insert(surveyReportingCohorts).values({
      tenantId, teamId: team!.id, surveyDefinitionId: definition!.id,
      periodStart, periodEnd, rosterUserIds, openedAt: new Date(),
    }).returning();
    await db.insert(surveyCycleScoringPolicies).values({
      tenantId, surveyDefinitionId: definition!.id, periodStart, periodEnd, scoringPolicyId: policy!.id,
    });
    const windows = await db.insert(surveyWindows).values(rosterUserIds.map((userId) => ({
      tenantId: tenantId!, userId, surveyDefinitionId: definition!.id, periodStart, periodEnd,
      reportingCohortId: cohort!.id, reportingTeamId: team!.id, reportingRosterUserIds: rosterUserIds,
      status: 'closed',
    }))).returning();
    const rows = await db.insert(surveyQuestionInsights).values(windows.flatMap((window) => selectedQuestions.map((question) => ({
      tenantId: tenantId!, userId: window.userId, surveyWindowId: window.id,
      surveyDefinitionId: definition!.id, surveyQuestionId: question.id, questionVersion: '1',
      questionGroup: 'autonomy', deidentifiedSummary: 'Safe synthetic summary.', outcome: 'scored', score: '70',
      signalDirection: 'mixed', signalSeverity: 'low', rootCauseCategory: 'autonomy',
      scoringPolicyVersion: 'fixture-v1', questionRubricVersion: 'fixture-v1', modelId: 'fixture',
      promptVersion: 'fixture', confidence: '0.8', privacyPolicyVersion: 'fixture',
      confirmedAt: periodStart, scoredAt: periodStart,
    })))).returning();
    const input = { tenantId, reportingCohortId: cohort!.id, questionGroup: 'autonomy' };
    const scope = await reader.load(input);
    expect(selectV2CohortReportInputs(scope, 'intermediate', periodEnd)).toMatchObject({
      eligible: true, requiredContributorCount: 5,
    });
    await db.update(surveyQuestionInsights).set({ withdrawnAt: periodEnd }).where(eq(surveyQuestionInsights.id, rows[0]!.id));
    expect(selectV2CohortReportInputs(await reader.load(input), 'intermediate', periodEnd).reason)
      .toBe('insufficient_contributors');
    await db.update(surveyQuestionInsights).set({ withdrawnAt: null }).where(eq(surveyQuestionInsights.id, rows[0]!.id));
    await db.update(users).set({ status: 'deleted', deletedAt: new Date() }).where(eq(users.id, roster[0]!.id));
    const afterDeletion = await reader.load(input);
    expect(afterDeletion?.questions.some((row) => row.userId === roster[0]!.id)).toBe(false);
    expect(selectV2CohortReportInputs(afterDeletion, 'intermediate', periodEnd).reason)
      .toBe('insufficient_contributors');
  });
});
