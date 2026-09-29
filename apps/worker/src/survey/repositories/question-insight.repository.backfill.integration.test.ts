import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  conversations, createDbClient, messages, surveyAssessments, surveyDefinitions,
  surveyEvidence, surveyQuestions, surveyQuestionWorkingInsights, surveyScoringPolicies,
  surveyWindowScoringPolicies, surveyWindows, tenants, users,
} from '@entalent/database';
import { SurveyEvidenceExtractionUseCase, V2_QUESTION_GROUP_BY_STABLE_KEY } from '@entalent/application';
import { ConversationRepository } from '../../conversation/repositories/conversation.repository';
import { QuestionInsightRepository } from './question-insight.repository';
import { SurveyRepository } from './survey.repository';

const databaseUrl = process.env['DATABASE_URL'];
const enabled = process.env['V2_BACKFILL_DB_TEST'] === '1';

describe.runIf(enabled)('V2 backfill on migrated PostgreSQL', () => {
  const client = databaseUrl ? createDbClient(databaseUrl) : null;
  const tenantIds: string[] = [];

  beforeAll(() => {
    if (!databaseUrl || !client) throw new Error('isolated_postgres_required');
    const url = new URL(databaseUrl);
    if (!['127.0.0.1', 'localhost'].includes(url.hostname) || !url.port) {
      throw new Error('isolated_postgres_required');
    }
  });

  afterAll(async () => {
    if (!client) return;
    for (const tenantId of tenantIds) await client.db.delete(tenants).where(eq(tenants.id, tenantId));
    await client.sql.end({ timeout: 2 });
  });

  it('persists every in-cycle employee source once without V1 evidence', async () => {
    if (!client) return;
    const db = client.db;
    const [tenant] = await db.insert(tenants).values({ name: `V2 backfill fixture ${randomUUID()}` })
      .returning();
    const tenantId = tenant!.id;
    tenantIds.push(tenantId);
    const [user] = await db.insert(users).values({ tenantId }).returning();
    const userId = user!.id;
    const [definition] = await db.insert(surveyDefinitions).values({
      tenantId, name: 'Synthetic V2 backfill fixture', version: `fixture-${randomUUID()}`,
    }).returning();
    const questions = await db.insert(surveyQuestions).values(
      Object.entries(V2_QUESTION_GROUP_BY_STABLE_KEY).map(([stableKey, questionGroup], index) => ({
        surveyDefinitionId: definition!.id, stableKey,
        title: stableKey, canonicalMeaning: `Synthetic ${stableKey}`,
        dimension: questionGroup, questionGroup, version: 'v2', displayOrder: index,
      })),
    ).returning();
    const targetQuestion = questions.find((question) => question.stableKey === 'q12_expectations')!;
    const rubric = { version: 'synthetic-backfill-v1', instructions: 'Synthetic test only.', anchors: [
      { score: 0, description: 'Low' }, { score: 100, description: 'High' },
    ] };
    const [policy] = await db.insert(surveyScoringPolicies).values({
      tenantId, version: 'synthetic-backfill-v1',
      rubrics: Object.fromEntries(questions.map((question) => [question.stableKey, rubric])),
      approvedAt: new Date(),
    }).returning();
    const now = Date.now();
    const [window] = await db.insert(surveyWindows).values({
      tenantId, userId, surveyDefinitionId: definition!.id,
      periodStart: new Date(now - 86_400_000), periodEnd: new Date(now + 86_400_000),
    }).returning();
    await db.insert(surveyWindowScoringPolicies).values({
      surveyWindowId: window!.id, tenantId, scoringPolicyId: policy!.id,
    });
    const [conversation] = await db.insert(conversations).values({
      tenantId, userId, channelType: 'dev', externalConversationId: `backfill-${randomUUID()}`,
    }).returning();
    const sourceTime = now - 120_000;
    const fixtureMessages = Array.from({ length: 35 }, (_, index) => ({
      id: randomUUID(), tenantId, userId, conversationId: conversation!.id,
      direction: index % 2 === 0 ? 'inbound' as const : 'outbound' as const,
      senderType: index % 2 === 0 ? 'user' : 'agent',
      text: `Turn ${index}`, occurredAt: new Date(sourceTime + index * 1_000),
    }));
    await db.insert(messages).values([
      { id: randomUUID(), tenantId, userId, conversationId: conversation!.id,
        direction: 'inbound', senderType: 'user', text: 'Old private turn',
        occurredAt: new Date(now - 2 * 86_400_000) },
      ...fixtureMessages,
      { id: randomUUID(), tenantId, userId, conversationId: conversation!.id,
        direction: 'inbound', senderType: 'user', text: 'Future private turn',
        occurredAt: new Date(now + 2 * 86_400_000) },
    ]);
    const expectedSources = fixtureMessages.filter((message) => message.direction === 'inbound');
    const ai = {
      evaluateSurveyEvidence: vi.fn(async (turns: Array<{ content: string }>) => ({
        candidateQuestionIds: [targetQuestion.id], voluntaryReopenQuestionIds: [],
        evidence: [{ questionId: targetQuestion.id,
          evidenceSummary: `Meaning from ${turns.at(-1)?.content}`,
          polarity: 'positive' as const, strength: 0.9, completeness: 1, confidence: 0.9,
          followUpProbeNeeded: false, thresholdReached: true,
          assessmentShouldRemainUnknown: false,
        }],
      })),
    };
    const questionRepo = new QuestionInsightRepository({ client: db } as never, {
      findCurrentHierarchyIdentifiers: async () => [],
    } as never);
    const surveyRepo = new SurveyRepository({ client: db } as never, {} as never, {
      findTeamByMemberId: async () => null,
    } as never);
    const useCase = new SurveyEvidenceExtractionUseCase(
      ai as never, new ConversationRepository({ client: db } as never),
      surveyRepo, undefined, questionRepo,
    );
    const input = { tenantId, userId, conversationId: conversation!.id };

    expect(await useCase.backfill(input)).toEqual({ windowsProcessed: 18 });
    const [working] = await db.select().from(surveyQuestionWorkingInsights)
      .where(eq(surveyQuestionWorkingInsights.surveyQuestionId, targetQuestion.id));
    expect(working.sourceMessageIds).toEqual(expectedSources.map((message) => message.id));
    expect(working.workingSummary?.split('\n')).toEqual(expectedSources.map((message) =>
      `Meaning from ${message.text}`));
    expect(ai.evaluateSurveyEvidence).toHaveBeenCalledTimes(18);
    expect(JSON.stringify(ai.evaluateSurveyEvidence.mock.calls)).not.toContain('Old private turn');
    expect(JSON.stringify(ai.evaluateSurveyEvidence.mock.calls)).not.toContain('Future private turn');
    expect(ai.evaluateSurveyEvidence).toHaveBeenNthCalledWith(2, [
      expect.objectContaining({ role: 'assistant', content: 'Turn 1' }),
      expect.objectContaining({ role: 'user', content: 'Turn 2' }),
    ], expect.anything(), { focusLatestEmployeeMessage: true });
    expect(await db.select().from(surveyEvidence)
      .where(eq(surveyEvidence.surveyWindowId, window!.id))).toHaveLength(0);
    expect(await db.select().from(surveyAssessments)
      .where(eq(surveyAssessments.surveyWindowId, window!.id))).toHaveLength(0);

    expect(await useCase.backfill(input)).toEqual({ windowsProcessed: 18 });
    const [unchanged] = await db.select().from(surveyQuestionWorkingInsights)
      .where(eq(surveyQuestionWorkingInsights.surveyQuestionId, targetQuestion.id));
    expect(unchanged.sourceMessageIds).toEqual(working.sourceMessageIds);
    expect(unchanged.workingSummary).toBe(working.workingSummary);
  }, 30_000);
});
