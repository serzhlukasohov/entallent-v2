import { randomUUID } from 'node:crypto';
import { Queue, Worker } from 'bullmq';
import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import {
  conversationDispatchIntents, conversationJobAdmissions, conversationTurnEffects,
  conversations, createDbClient, messages, surveyDefinitions, surveyQuestions,
  surveyQuestionWorkingInsights, surveyScoringPolicies, surveyWindowScoringPolicies,
  surveyWindows, tenants, users,
} from '@entalent/database';
import { SurveyEvidenceExtractionUseCase, LEGACY_V2_QUESTION_GROUP_BY_STABLE_KEY } from '@entalent/application';
import { ConversationRepository } from '../conversation/repositories/conversation.repository';
import { DatabaseService } from '../database/database.service';
import { QuestionCutoffProcessor } from './question-cutoff.processor';
import { QuestionInsightRepository } from './repositories/question-insight.repository';
import { SurveyEvidenceIntentRepository } from './repositories/survey-evidence-intent.repository';
import { SurveyRepository } from './repositories/survey.repository';
import { SurveyEvidenceProcessor } from './survey-evidence.processor';

const databaseUrl = process.env['DATABASE_URL'];
const redisUrl = process.env['REDIS_URL'];
const enabled = process.env['V2_CONVERSATION_QUEUE_TEST'] === '1' && !!databaseUrl && !!redisUrl;

describe.skipIf(!enabled)('committed survey evidence recovery on PostgreSQL and Redis', () => {
  it('rolls back capture with its receipt and recovers a lost queued job once', async () => {
    const postgres = new URL(databaseUrl!);
    const redis = new URL(redisUrl!);
    if (!['127.0.0.1', 'localhost'].includes(postgres.hostname) || !postgres.port
      || !['127.0.0.1', 'localhost'].includes(redis.hostname) || redis.pathname !== '/15') {
      throw new Error('isolated_postgres_and_redis_required');
    }
    const client = createDbClient(databaseUrl!);
    const database = new DatabaseService({ get: () => databaseUrl } as never);
    database.onModuleInit();
    const connection = { host: redis.hostname, port: Number(redis.port), db: 15 };
    const evidenceQueue = new Queue(`evidence-recovery-${randomUUID()}`, { connection });
    let worker: Worker | undefined;
    let tenantId: string | undefined;
    try {
      const db = client.db;
      const [tenant] = await db.insert(tenants)
        .values({ name: `Evidence recovery ${randomUUID()}` }).returning();
      tenantId = tenant!.id;
      const [user] = await db.insert(users).values({ tenantId }).returning();
      const [definition] = await db.insert(surveyDefinitions).values({
        tenantId, name: 'Evidence recovery', version: `fixture-${randomUUID()}`,
      }).returning();
      const questions = await db.insert(surveyQuestions).values(
        Object.entries(LEGACY_V2_QUESTION_GROUP_BY_STABLE_KEY).map(([stableKey, questionGroup], index) => ({
          surveyDefinitionId: definition!.id, stableKey, title: stableKey,
          canonicalMeaning: `Synthetic ${stableKey}`, dimension: questionGroup,
          questionGroup, version: 'v2', displayOrder: index,
        })),
      ).returning();
      const [policy] = await db.insert(surveyScoringPolicies).values({
        tenantId, version: `synthetic-${randomUUID()}`,
        rubrics: Object.fromEntries(questions.map((question) => [question.stableKey, {
          version: 'synthetic', instructions: 'Test only',
          anchors: [{ score: 0, description: 'Low' }, { score: 100, description: 'High' }],
        }])),
        approvedAt: new Date(),
      }).returning();
      const now = Date.now();
      const [window] = await db.insert(surveyWindows).values({
        tenantId, userId: user!.id, surveyDefinitionId: definition!.id,
        periodStart: new Date(now - 86_400_000), periodEnd: new Date(now + 86_400_000),
      }).returning();
      await db.insert(surveyWindowScoringPolicies).values({
        surveyWindowId: window!.id, tenantId, scoringPolicyId: policy!.id,
      });
      const [conversation] = await db.insert(conversations).values({
        tenantId, userId: user!.id, channelType: 'dev', externalConversationId: 'D1',
      }).returning();
      const [inbound] = await db.insert(messages).values({
        tenantId, userId: user!.id, conversationId: conversation!.id,
        direction: 'inbound', senderType: 'user', text: 'I choose my methods',
        occurredAt: new Date(now - 60_000),
      }).returning();
      const [outbound] = await db.insert(messages).values({
        tenantId, userId: user!.id, conversationId: conversation!.id,
        direction: 'outbound', senderType: 'agent', text: 'Tell me more',
        occurredAt: new Date(now - 59_000),
        metadata: { sourceInboundMessageId: inbound!.id },
      }).returning();
      await db.insert(conversationJobAdmissions).values({
        messageId: inbound!.id, tenantId, userId: user!.id,
        conversationId: conversation!.id, externalWorkspaceId: 'T1',
        externalConversationId: 'D1', eventId: randomUUID(),
        requestId: randomUUID(), traceId: randomUUID(),
      });
      await db.insert(conversationTurnEffects).values({
        inboundMessageId: inbound!.id, outboundMessageId: outbound!.id,
        tenantId, userId: user!.id, conversationId: conversation!.id,
      });
      await db.insert(conversationDispatchIntents).values({
        inboundMessageId: inbound!.id, kind: 'survey_evidence', targetId: inbound!.id,
      });
      await db.update(conversationDispatchIntents)
        .set({ lastQueuedAt: new Date(Date.now() - 10 * 60_000) })
        .where(eq(conversationDispatchIntents.inboundMessageId, inbound!.id));

      const selectedQuestion = questions.find((question) => question.questionGroup === 'autonomy')!;
      const rootDbClient = database.client;
      const ai = { evaluateSurveyEvidence: vi.fn(async () => {
        expect(database.client).toBe(rootDbClient);
        return { evidence: [{ questionId: selectedQuestion.id, evidenceSummary: 'Can choose methods.',
          polarity: 'positive', strength: 0.9, completeness: 1, confidence: 0.9,
          assessmentShouldRemainUnknown: false }] };
      }) };
      const conversationRepo = new ConversationRepository(database);
      const questionRepo = new QuestionInsightRepository(database, {
        findCurrentHierarchyIdentifiers: async () => [],
      } as never);
      const surveyRepo = new SurveyRepository(database, {} as never, {
        findTeamByMemberId: async () => null,
      } as never);
      const useCase = new SurveyEvidenceExtractionUseCase(
        ai as never, conversationRepo, surveyRepo, undefined, questionRepo,
      );
      const intentRepo = new SurveyEvidenceIntentRepository(database);
      const processor = new SurveyEvidenceProcessor(
        useCase, { executePending: async () => 0 } as never, intentRepo,
      );
      const payload = {
        conversationId: conversation!.id, userId: user!.id, tenantId,
        inboundMessageId: inbound!.id, traceId: 'evidence-recovery',
      };
      const originalCapture = questionRepo.captureMeaning.bind(questionRepo);
      const failCapture = vi.spyOn(questionRepo, 'captureMeaning').mockImplementationOnce(async (input) => {
        await originalCapture(input);
        throw new Error('injected_after_capture');
      });
      await expect(processor.process({ id: 'failed-evidence', data: payload } as never))
        .rejects.toThrow('survey_evidence_processing_failed');
      failCapture.mockRestore();
      expect(await db.select().from(surveyQuestionWorkingInsights)
        .where(eq(surveyQuestionWorkingInsights.userId, user!.id))).toEqual([]);
      expect(await intentRepo.status(payload)).toBe('pending');


      const original = await evidenceQueue.add('evaluate', payload,
        { jobId: `survey-evidence-${inbound!.id}` });
      vi.spyOn(conversationRepo, 'isUserRuntimeEligible').mockResolvedValue(true);
      const cutoff = new QuestionCutoffProcessor(
        { execute: async () => ({ tenantsProcessed: 0, expiredQuestionCount: 0,
          overdueReplyCount: 0 }) } as never,
        { execute: async () => ({ usersScanned: 0, finalizedQuestionCount: 0,
          failedUserCount: 0 }) } as never,
        {} as never,
        { findUndispatchedTimelyQuestionReplies: async () => [],
          findQueuedTimelyQuestionRepliesWithoutReceipt: async () => [] } as never,
        { add: vi.fn() } as never,
        conversationRepo, undefined, undefined, undefined, undefined, evidenceQueue as never,
      );
      await cutoff.process({ name: 'cutoff' } as never);
      expect(await evidenceQueue.getWaitingCount()).toBe(1);
      await original.remove();
      await cutoff.process({ name: 'cutoff' } as never);
      expect(await evidenceQueue.getWaitingCount()).toBe(1);
      worker = new Worker(evidenceQueue.name, (job) => processor.process(job as never),
        { connection, autorun: false });
      const completion = new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('evidence_recovery_timeout')), 10_000);
        worker!.once('completed', () => { clearTimeout(timer); resolve(); });
        worker!.once('failed', (_job, error) => { clearTimeout(timer); reject(error); });
      });
      void worker.run();
      await completion;
      expect(await intentRepo.status(payload)).toBe('complete');
      const working = await db.select().from(surveyQuestionWorkingInsights)
        .where(eq(surveyQuestionWorkingInsights.userId, user!.id));
      expect(working).toHaveLength(1);
      expect(working[0]?.sourceMessageIds).toEqual([inbound!.id]);
      await processor.process({ id: 'duplicate-evidence', data: payload } as never);
      expect(ai.evaluateSurveyEvidence).toHaveBeenCalledTimes(2);
      expect(await db.select().from(surveyQuestionWorkingInsights)
        .where(eq(surveyQuestionWorkingInsights.userId, user!.id))).toHaveLength(1);
      expect(await conversationRepo.findRecoverableSurveyEvidence(new Date())).toEqual([]);
    } finally {
      if (worker) await worker.close();
      await evidenceQueue.obliterate({ force: true });
      await evidenceQueue.close();
      if (tenantId) await client.db.delete(tenants).where(eq(tenants.id, tenantId));
      await database.onModuleDestroy();
      await client.sql.end({ timeout: 2 });
    }
  });
});
