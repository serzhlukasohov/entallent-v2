import { randomUUID } from 'node:crypto';
import { Queue, Worker } from 'bullmq';
import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import {
  conversationDispatchIntents, conversationJobAdmissions, conversationTurnEffects,
  conversations, createDbClient, messages, tenants, userStyleProfiles, users,
} from '@entalent/database';
import { StyleAnalysisUseCase } from '@entalent/application';
import { ConversationRepository } from '../../conversation/repositories/conversation.repository';
import { DatabaseService } from '../../database/database.service';
import { QuestionCutoffProcessor } from '../../survey/question-cutoff.processor';
import { StyleAnalysisProcessor } from '../style-analysis.processor';
import { StyleProfileRepository } from './style-profile.repository';

const databaseUrl = process.env['DATABASE_URL'];
const redisUrl = process.env['REDIS_URL'];
const enabled = process.env['V2_CONVERSATION_QUEUE_TEST'] === '1' && !!databaseUrl && !!redisUrl;

describe.skipIf(!enabled)('committed style analysis recovery on PostgreSQL and Redis', () => {
  it('uses source-bounded history, rolls back an unqueued result, and recovers one lost job', async () => {
    const target = new URL(databaseUrl!);
    const redis = new URL(redisUrl!);
    if (!['127.0.0.1', 'localhost'].includes(target.hostname) || !target.port
      || !['127.0.0.1', 'localhost'].includes(redis.hostname) || redis.pathname !== '/15') {
      throw new Error('isolated_postgres_and_redis_required');
    }
    const client = createDbClient(databaseUrl!);
    const database = new DatabaseService({ get: () => databaseUrl } as never);
    database.onModuleInit();
    const connection = { host: redis.hostname, port: Number(redis.port), db: 15 };
    const styleQueue = new Queue(`style-recovery-${randomUUID()}`, { connection });
    let styleWorker: Worker | undefined;
    let tenantId: string | undefined;
    try {
      const db = client.db;
      const [tenant] = await db.insert(tenants)
        .values({ name: `Style recovery ${randomUUID()}` }).returning();
      tenantId = tenant!.id;
      const [user] = await db.insert(users).values({ tenantId }).returning();
      const [conversation] = await db.insert(conversations).values({
        tenantId, userId: user!.id, channelType: 'dev', externalConversationId: 'D1',
      }).returning();
      const baseTime = Date.now() - 60_000;
      const inboundRows = await db.insert(messages).values([0, 1, 2].map((index) => ({
        tenantId: tenantId!, userId: user!.id, conversationId: conversation!.id,
        direction: 'inbound', senderType: 'user',
        text: `source style ${index}`, occurredAt: new Date(baseTime + index * 1_000),
      }))).returning();
      const source = inboundRows[2]!;
      const [outbound] = await db.insert(messages).values({
        tenantId, userId: user!.id, conversationId: conversation!.id,
        direction: 'outbound', senderType: 'agent', text: 'Reply',
        occurredAt: new Date(baseTime + 3_000),
        metadata: { sourceInboundMessageId: source.id },
      }).returning();
      await db.insert(messages).values({
        tenantId, userId: user!.id, conversationId: conversation!.id,
        direction: 'inbound', senderType: 'user', text: 'future private style',
        occurredAt: new Date(baseTime + 4_000),
      });
      await db.insert(conversationJobAdmissions).values({
        messageId: source.id, tenantId, userId: user!.id, conversationId: conversation!.id,
        externalWorkspaceId: 'T1', externalConversationId: 'D1',
        eventId: randomUUID(), requestId: randomUUID(), traceId: randomUUID(),
      });
      await db.insert(conversationTurnEffects).values({
        inboundMessageId: source.id, outboundMessageId: outbound!.id,
        tenantId, userId: user!.id, conversationId: conversation!.id,
      });
      await db.insert(conversationDispatchIntents).values({
        inboundMessageId: source.id, kind: 'style_analysis', targetId: source.id,
      });
      const input = { inboundMessageId: source.id, tenantId, userId: user!.id,
        conversationId: conversation!.id };
      const ai = { analyzeStyle: vi.fn().mockResolvedValue({
        dimensions: { register: 1, humor: 0.8, verbosity: 0.4, emoji: 0.2 },
        phrases: [],
      }) };
      const conversationRepo = new ConversationRepository(database);
      const styleRepo = new StyleProfileRepository(database);
      const useCase = new StyleAnalysisUseCase(ai as never, conversationRepo, styleRepo);

      await expect(useCase.execute(input)).rejects.toThrow('conversation_dispatch_intent_immutable');
      expect(await db.select().from(userStyleProfiles).where(eq(userStyleProfiles.userId, user!.id)))
        .toHaveLength(0);
      await db.update(conversationDispatchIntents)
        .set({ lastQueuedAt: new Date(Date.now() - 10 * 60_000) })
        .where(eq(conversationDispatchIntents.inboundMessageId, source.id));
      expect((await conversationRepo.findRecoverableStyleAnalyses(new Date()))
        .map((intent) => intent.inboundMessageId)).toContain(source.id);
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
        conversationRepo,
        undefined,
        undefined,
        styleQueue as never,
      );
      await cutoff.process({ name: 'cutoff' } as never);
      expect(await styleQueue.getWaitingCount()).toBe(1);
      styleWorker = new Worker(styleQueue.name,
        async (job) => new StyleAnalysisProcessor(useCase).process(job as never),
        { connection, autorun: false });
      const completion = new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('style_recovery_timeout')), 10_000);
        styleWorker!.once('completed', () => { clearTimeout(timer); resolve(); });
        styleWorker!.once('failed', (_job, error) => { clearTimeout(timer); reject(error); });
      });
      void styleWorker.run();
      await completion;
      await useCase.execute(input);
      const [profile] = await db.select().from(userStyleProfiles)
        .where(eq(userStyleProfiles.userId, user!.id));
      expect(profile?.conversationsAnalyzed).toBe(1);
      expect(await styleRepo.isCommittedStyleAnalysisComplete(input)).toBe(true);
      expect(await conversationRepo.findRecoverableStyleAnalyses(new Date())).toEqual([]);
      expect(ai.analyzeStyle).toHaveBeenCalledTimes(2);
      for (const [turns] of ai.analyzeStyle.mock.calls) {
        expect(turns).toHaveLength(3);
        expect(turns).not.toContain('future private style');
      }

      const [later, latest] = await db.insert(messages).values([1, 2].map((offset) => ({
        tenantId: tenantId!, userId: user!.id, conversationId: conversation!.id,
        direction: 'inbound', senderType: 'user', text: `later style ${offset}`,
        occurredAt: new Date(baseTime + (4 + offset) * 1_000),
      }))).returning();
      for (const sourceMessage of [later!, latest!]) {
        const [reply] = await db.insert(messages).values({
          tenantId, userId: user!.id, conversationId: conversation!.id,
          direction: 'outbound', senderType: 'agent', text: 'Reply',
          occurredAt: new Date(sourceMessage.occurredAt.getTime() + 100),
          metadata: { sourceInboundMessageId: sourceMessage.id },
        }).returning();
        await db.insert(conversationJobAdmissions).values({
          messageId: sourceMessage.id, tenantId, userId: user!.id,
          conversationId: conversation!.id, externalWorkspaceId: 'T1',
          externalConversationId: 'D1', eventId: randomUUID(),
          requestId: randomUUID(), traceId: randomUUID(),
        });
        await db.insert(conversationTurnEffects).values({
          inboundMessageId: sourceMessage.id, outboundMessageId: reply!.id,
          tenantId, userId: user!.id, conversationId: conversation!.id,
        });
        await db.insert(conversationDispatchIntents).values({
          inboundMessageId: sourceMessage.id, kind: 'style_analysis',
          targetId: sourceMessage.id,
        });
        await db.update(conversationDispatchIntents)
          .set({ lastQueuedAt: new Date() })
          .where(eq(conversationDispatchIntents.inboundMessageId, sourceMessage.id));
      }
      await useCase.execute({ ...input, inboundMessageId: latest!.id });
      const [afterLatest] = await db.select().from(userStyleProfiles)
        .where(eq(userStyleProfiles.userId, user!.id));
      await useCase.execute({ ...input, inboundMessageId: later!.id });
      const [afterStale] = await db.select().from(userStyleProfiles)
        .where(eq(userStyleProfiles.userId, user!.id));
      expect(afterStale?.dimensions).toEqual(afterLatest?.dimensions);
      expect(afterStale?.conversationsAnalyzed).toBe(afterLatest?.conversationsAnalyzed);
      expect(await styleRepo.isCommittedStyleAnalysisComplete({
        ...input, inboundMessageId: later!.id,
      })).toBe(true);
    } finally {
      if (styleWorker) await styleWorker.close();
      await styleQueue.obliterate({ force: true });
      await styleQueue.close();
      if (tenantId) await client.db.delete(tenants).where(eq(tenants.id, tenantId));
      await database.onModuleDestroy();
      await client.sql.end({ timeout: 2 });
    }
  });
});
