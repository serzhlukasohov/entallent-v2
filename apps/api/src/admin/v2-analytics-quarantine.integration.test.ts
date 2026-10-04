import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq, inArray } from 'drizzle-orm';
import {
  conversations, messages, surveyAssessments, surveyDefinitions, surveyEvidence, surveyQuestions,
  surveyScoringPolicies, surveyWindowScoringPolicies, surveyWindows, tenants, users,
} from '@entalent/database';
import { AnalyticsController } from './analytics.controller';
import { ManagerDashboardReadModel } from './manager-dashboard.read-model';
import { SurveyCoverageController } from './survey-coverage.controller';

const databaseUrl = process.env['DATABASE_URL'];

describe.runIf(Boolean(databaseUrl))('V2 quarantine from internal V1 analytics', () => {
  const client = databaseUrl ? postgres(databaseUrl, { max: 1 }) : null;
  const db = client ? drizzle(client) : null;
  const tenantIds: string[] = [];

  beforeAll(async () => {
    if (!client) return;
    const [row] = await client`select to_regclass('public.survey_window_scoring_policies') as table_name`;
    if (!row?.['table_name']) throw new Error('v2_migrated_schema_required');
  });

  afterAll(async () => {
    if (db) {
      for (const tenantId of tenantIds) await db.delete(tenants).where(eq(tenants.id, tenantId));
    }
    await client?.end();
  });

  it('removes legacy survey inputs from overview, coverage, and trends after V2 binding', async () => {
    if (!db) return;
    const now = new Date();
    const [tenant] = await db.insert(tenants).values({ name: `V2 API boundary ${randomUUID()}` }).returning();
    const scopedTenantId = tenant!.id;
    tenantIds.push(scopedTenantId);
    const [definition] = await db.insert(surveyDefinitions).values({
      tenantId: scopedTenantId, name: 'Synthetic survey', version: 'fixture-v1',
    }).returning();
    const [question] = await db.insert(surveyQuestions).values({
      surveyDefinitionId: definition!.id, stableKey: 'synthetic_question',
      title: 'Synthetic question', canonicalMeaning: 'Synthetic meaning', dimension: 'growth',
    }).returning();
    const people = await db.insert(users).values(Array.from({ length: 5 }, () => ({ tenantId: scopedTenantId }))).returning();
    const conversationsForPeople = await db.insert(conversations).values(people.map((person) => ({
      tenantId: scopedTenantId, userId: person.id, channelType: 'slack',
      externalConversationId: randomUUID(),
    }))).returning();
    await db.insert(messages).values(people.map((person, index) => ({
      tenantId: scopedTenantId, userId: person.id,
      conversationId: conversationsForPeople[index]!.id,
      direction: 'inbound', senderType: 'user', text: 'Private fixture message',
      occurredAt: now,
    })));
    const windows = await db.insert(surveyWindows).values(people.map((person) => ({
      tenantId: scopedTenantId, userId: person.id, surveyDefinitionId: definition!.id,
      periodStart: new Date(now.getTime() - 86_400_000),
      periodEnd: new Date(now.getTime() + 86_400_000),
    }))).returning();
    const assessments = await db.insert(surveyAssessments).values(windows.map((window) => ({
      surveyWindowId: window.id, surveyQuestionId: question!.id,
      status: 'scored', score: '8', evaluatorVersion: 'fixture-v1',
    }))).returning();
    await db.insert(surveyEvidence).values(windows.map((window, index) => ({
      surveyWindowId: window.id, surveyQuestionId: question!.id,
      userId: people[index]!.id, evidenceSummary: 'Private V1 fixture',
      polarity: 'positive', strength: '0.8', completeness: '0.8', confidence: '0.8',
      evaluatorVersion: 'fixture-v1', promptVersion: 'fixture-v1',
      createdAt: new Date(now.getTime() - 12 * 60 * 60 * 1000),
    })));

    const [otherTenant] = await db.insert(tenants).values({ name: `Other API tenant ${randomUUID()}` }).returning();
    tenantIds.push(otherTenant!.id);
    const [otherPerson] = await db.insert(users).values({ tenantId: otherTenant!.id }).returning();
    const [otherConversation] = await db.insert(conversations).values({
      tenantId: otherTenant!.id, userId: otherPerson!.id, channelType: 'slack',
      externalConversationId: randomUUID(),
    }).returning();
    await db.insert(messages).values({
      tenantId: otherTenant!.id, userId: otherPerson!.id,
      conversationId: otherConversation!.id,
      direction: 'inbound', senderType: 'user', text: 'Other tenant fixture message',
      occurredAt: now,
    });
    const [otherDefinition] = await db.insert(surveyDefinitions).values({
      tenantId: otherTenant!.id, name: 'Other synthetic survey', version: 'fixture-v1',
    }).returning();
    const [otherQuestion] = await db.insert(surveyQuestions).values({
      surveyDefinitionId: otherDefinition!.id, stableKey: 'other_question',
      title: 'Other question', canonicalMeaning: 'Other meaning', dimension: 'growth',
    }).returning();
    const [otherWindow] = await db.insert(surveyWindows).values({
      tenantId: otherTenant!.id, userId: otherPerson!.id, surveyDefinitionId: otherDefinition!.id,
      periodStart: new Date(now.getTime() - 86_400_000),
      periodEnd: new Date(now.getTime() + 86_400_000),
    }).returning();
    await db.insert(surveyAssessments).values({
      surveyWindowId: otherWindow!.id, surveyQuestionId: otherQuestion!.id,
      status: 'scored', score: '9', evaluatorVersion: 'fixture-v1',
    });

    const service = { client: db } as never;
    const analytics = new AnalyticsController(service);
    const coverage = new SurveyCoverageController(service);
    const trends = new ManagerDashboardReadModel(service, { get: vi.fn() } as never);
    const mismatchedAssessments = await db.insert(surveyAssessments).values(windows.map((window) => ({
      surveyWindowId: window.id, surveyQuestionId: otherQuestion!.id,
      status: 'scored', score: '9', evaluatorVersion: 'fixture-cross-definition',
    }))).returning();
    await db.update(surveyAssessments).set({ status: 'unknown', score: null })
      .where(eq(surveyAssessments.surveyQuestionId, question!.id));
    const mismatchedOverview = await analytics.overview(scopedTenantId);
    expect((mismatchedOverview['survey'] as { usersWithScoredAssessments: number }).usersWithScoredAssessments)
      .toBe(0);
    expect((await coverage.getCoverage(scopedTenantId)).questions).toMatchObject([
      { stableKey: 'synthetic_question', statusDistribution: { unknown: 5 }, avgScore: null },
    ]);
    await db.delete(surveyAssessments).where(inArray(surveyAssessments.id,
      mismatchedAssessments.map((assessment) => assessment.id)));
    const foreignDefinitionWindows = await db.insert(surveyWindows).values(people.map((person) => ({
      tenantId: scopedTenantId, userId: person.id, surveyDefinitionId: otherDefinition!.id,
      periodStart: new Date(now.getTime() - 86_400_000),
      periodEnd: new Date(now.getTime() + 86_400_000),
    }))).returning();
    await db.insert(surveyAssessments).values(foreignDefinitionWindows.map((window) => ({
      surveyWindowId: window.id, surveyQuestionId: otherQuestion!.id,
      status: 'scored', score: '9', evaluatorVersion: 'fixture-foreign-definition',
    })));
    const foreignDefinitionOverview = await analytics.overview(scopedTenantId);
    expect((foreignDefinitionOverview['survey'] as { usersWithScoredAssessments: number })
      .usersWithScoredAssessments).toBe(0);
    expect((await coverage.getCoverage(scopedTenantId)).questions.map((item) => item.stableKey))
      .toEqual(['synthetic_question']);
    await db.delete(surveyWindows).where(inArray(surveyWindows.id,
      foreignDefinitionWindows.map((window) => window.id)));
    const otherPeople = [otherPerson!, ...(await db.insert(users).values(
      Array.from({ length: 4 }, () => ({ tenantId: otherTenant!.id })),
    ).returning())];
    const legitimateTrends = await trends.getTrends(scopedTenantId, '2');
    const foreignOwnerWindows = await db.insert(surveyWindows).values(otherPeople.map((person) => ({
      tenantId: scopedTenantId, userId: person.id, surveyDefinitionId: definition!.id,
      periodStart: new Date(now.getTime() - 86_400_000),
      periodEnd: new Date(now.getTime() + 86_400_000),
    }))).returning();
    await db.insert(surveyAssessments).values(foreignOwnerWindows.map((window) => ({
      surveyWindowId: window.id, surveyQuestionId: question!.id,
      status: 'scored', score: '9', evaluatorVersion: 'fixture-foreign-owner',
    })));
    await db.insert(surveyEvidence).values(foreignOwnerWindows.map((window) => ({
      surveyWindowId: window.id, surveyQuestionId: question!.id,
      userId: window.userId, evidenceSummary: 'Cross-tenant private detail',
      polarity: 'negative', strength: '0.8', completeness: '0.8', confidence: '0.8',
      evaluatorVersion: 'fixture-foreign-owner', promptVersion: 'fixture-foreign-owner',
      createdAt: new Date(now.getTime() - 12 * 60 * 60 * 1000),
    })));
    const foreignOwnerOverview = await analytics.overview(scopedTenantId);
    expect((foreignOwnerOverview['survey'] as { usersWithScoredAssessments: number })
      .usersWithScoredAssessments).toBe(0);
    expect((await coverage.getCoverage(scopedTenantId)).questions).toMatchObject([
      { stableKey: 'synthetic_question', statusDistribution: { unknown: 5 }, avgScore: null },
    ]);
    expect(await trends.getTrends(scopedTenantId, '2')).toEqual(legitimateTrends);
    await db.delete(surveyWindows).where(inArray(surveyWindows.id,
      foreignOwnerWindows.map((window) => window.id)));
    await db.update(surveyAssessments).set({ status: 'scored', score: '8' })
      .where(eq(surveyAssessments.surveyQuestionId, question!.id));
    const beforeOverview = await analytics.overview(scopedTenantId);
    expect((beforeOverview['survey'] as { usersWithScoredAssessments: number }).usersWithScoredAssessments).toBe(5);
    expect((beforeOverview['users'] as { activeLast7Days: number }).activeLast7Days).toBe(5);
    expect((beforeOverview['messages'] as { totalLast30Days: number }).totalLast30Days).toBe(5);
    expect((await coverage.getCoverage(scopedTenantId)).questions).toHaveLength(1);
    expect((await coverage.getCoverage(scopedTenantId)).cohortSize).toBe(5);
    expect(await analytics.overview(otherTenant!.id)).toMatchObject({ cohortInsufficient: true });
    expect((await coverage.getCoverage(otherTenant!.id)).questions).toEqual([]);
    await db.update(surveyAssessments).set({ status: 'unknown', score: null })
      .where(eq(surveyAssessments.id, assessments[0]!.id));
    expect((await coverage.getCoverage(scopedTenantId)).questions).toEqual([]);
    await db.update(surveyAssessments).set({ status: 'scored', score: '8' })
      .where(eq(surveyAssessments.id, assessments[0]!.id));
    const beforeTrends = await trends.getTrends(scopedTenantId, '2');
    expect(beforeTrends.suppressed).toBe(false);
    expect(beforeTrends.engagement.at(-1)).toMatchObject({ activeUsers: 5, inboundMessages: 5 });
    expect(beforeTrends.signalCapture.reduce((sum, point) => sum + point.total, 0)).toBe(5);
    expect(beforeTrends.coverageFunnel['scored']).toBe(5);
    expect(beforeTrends.questionSentiment[0]?.total).toBe(5);

    const mismatchedTrendAssessments = await db.insert(surveyAssessments).values(windows.map((window) => ({
      surveyWindowId: window.id, surveyQuestionId: otherQuestion!.id,
      status: 'scored', score: '9', evaluatorVersion: 'fixture-cross-trend',
    }))).returning();
    const mismatchedTrendEvidence = await db.insert(surveyEvidence).values(windows.flatMap((window) =>
      [otherQuestion!.id, question!.id].map((surveyQuestionId) => ({
        surveyWindowId: window.id, surveyQuestionId,
        userId: otherPerson!.id, evidenceSummary: 'Cross-tenant private detail',
        polarity: 'negative', strength: '0.8', completeness: '0.8', confidence: '0.8',
        evaluatorVersion: 'fixture-cross-trend', promptVersion: 'fixture-cross-trend',
        createdAt: new Date(now.getTime() - 12 * 60 * 60 * 1000),
      })))).returning();
    expect(await trends.getTrends(scopedTenantId, '2')).toEqual(beforeTrends);
    await db.delete(surveyAssessments).where(inArray(surveyAssessments.id,
      mismatchedTrendAssessments.map((assessment) => assessment.id)));
    await db.delete(surveyEvidence).where(inArray(surveyEvidence.id,
      mismatchedTrendEvidence.map((evidence) => evidence.id)));

    await db.delete(surveyEvidence).where(eq(surveyEvidence.userId, people[0]!.id));
    const smallQuestionTrends = await trends.getTrends(scopedTenantId, '2');
    expect(smallQuestionTrends).toMatchObject({
      suppressed: true,
      engagement: [],
      signalCapture: [],
      coverageFunnel: {},
      questionSentiment: [],
    });

    const [policy] = await db.insert(surveyScoringPolicies).values({
      tenantId: scopedTenantId, version: 'synthetic-v2', rubrics: {}, approvedAt: now,
    }).returning();
    await db.insert(surveyWindowScoringPolicies).values(windows.map((window) => ({
      surveyWindowId: window.id, tenantId: scopedTenantId, scoringPolicyId: policy!.id,
    })));

    const afterOverview = await analytics.overview(scopedTenantId);
    expect((afterOverview['users'] as { activeLast7Days: number }).activeLast7Days).toBe(5);
    expect((afterOverview['survey'] as { usersWithScoredAssessments: number }).usersWithScoredAssessments).toBe(0);
    expect((await coverage.getCoverage(scopedTenantId)).questions).toEqual([]);
    const afterTrends = await trends.getTrends(scopedTenantId, '2');
    expect(afterTrends.suppressed).toBe(false);
    expect(afterTrends.signalCapture.reduce((sum, point) => sum + point.total, 0)).toBe(0);
    expect(afterTrends.coverageFunnel['scored']).toBe(0);
    expect(afterTrends.questionSentiment).toEqual([]);

    await db.delete(messages).where(eq(messages.userId, people[0]!.id));
    expect(await analytics.overview(scopedTenantId)).toMatchObject({ cohortInsufficient: true });
    const smallActivityTrends = await trends.getTrends(scopedTenantId, '2');
    expect(smallActivityTrends.suppressed).toBe(true);
    expect(smallActivityTrends.engagement).toEqual([]);
  });
});
