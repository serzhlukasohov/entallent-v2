import { randomUUID } from 'node:crypto';
import { Queue, Worker } from 'bullmq';
import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import {
  conversationDispatchIntents, conversationJobAdmissions, conversationTurnEffects,
  conversations, createDbClient, memoryItems, messages, scheduledActions,
  tenants, userGoals, users,
} from '@entalent/database';
import { FollowUpSchedulerUseCase, MemoryExtractionUseCase } from '@entalent/application';
import { ConversationRepository } from '../conversation/repositories/conversation.repository';
import { DatabaseService } from '../database/database.service';
import { ScheduledActionRepository } from '../followup/repositories/scheduled-action.repository';
import { QuestionCutoffProcessor } from '../survey/question-cutoff.processor';
import { GoalRepository } from './repositories/goal.repository';
import { MemoryExtractionIntentRepository } from './repositories/memory-extraction-intent.repository';
import { MemoryRepository } from './repositories/memory.repository';
import { MemoryExtractionProcessor } from './memory-extraction.processor';

const databaseUrl = process.env['DATABASE_URL'];
const redisUrl = process.env['REDIS_URL'];
const enabled = process.env['V2_CONVERSATION_QUEUE_TEST'] === '1' && !!databaseUrl && !!redisUrl;

describe.skipIf(!enabled)('committed memory extraction recovery on PostgreSQL and Redis', () => {
  it('rolls back all effects, ignores a live job, and recovers a lost job once', async () => {
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
    const memoryQueue = new Queue(`memory-recovery-${randomUUID()}`, { connection });
    const followUpQueue = new Queue(`memory-followup-${randomUUID()}`, { connection });
    let worker: Worker | undefined;
    let tenantId: string | undefined;
    try {
      const db = client.db;
      const [tenant] = await db.insert(tenants)
        .values({ name: `Memory recovery ${randomUUID()}` }).returning();
      tenantId = tenant!.id;
      const [user] = await db.insert(users).values({ tenantId }).returning();
      const [conversation] = await db.insert(conversations).values({
        tenantId, userId: user!.id, channelType: 'dev', externalConversationId: 'D1',
      }).returning();
      const [inbound] = await db.insert(messages).values({
        tenantId, userId: user!.id, conversationId: conversation!.id,
        direction: 'inbound', senderType: 'user', text: 'I want to learn design',
        occurredAt: new Date(Date.now() - 60_000),
      }).returning();
      const [outbound] = await db.insert(messages).values({
        tenantId, userId: user!.id, conversationId: conversation!.id,
        direction: 'outbound', senderType: 'agent', text: 'Let us make a plan',
        occurredAt: new Date(Date.now() - 59_000),
        metadata: { sourceInboundMessageId: inbound!.id },
      }).returning();
      await db.insert(messages).values({
        tenantId, userId: user!.id, conversationId: conversation!.id,
        direction: 'inbound', senderType: 'user', text: 'later private message',
        occurredAt: new Date(Date.now() - 58_000),
      });
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
        inboundMessageId: inbound!.id, kind: 'memory_extraction', targetId: inbound!.id,
      });
      await db.update(conversationDispatchIntents)
        .set({ lastQueuedAt: new Date(Date.now() - 10 * 60_000) })
        .where(eq(conversationDispatchIntents.inboundMessageId, inbound!.id));

      const input = {
        conversationId: conversation!.id, userId: user!.id, tenantId,
        inboundMessageId: inbound!.id, outboundMessageId: outbound!.id,
        channelType: 'dev', externalConversationId: 'D1',
      };
      const proposal = {
        memoryItems: [{ action: 'create', category: 'skill', content: 'Learning design',
          confidence: 0.9, importance: 0.8, sensitivity: 'normal', expectedLifetime: 'months' }],
        goalProposals: [{ action: 'create', title: 'Learn design', category: 'development',
          confidence: 0.9 }],
        commitmentProposals: [],
        followUpCandidates: [{ type: 'follow_up', topic: 'design practice', reason: 'Plan review',
          recommendedDelayDays: 3, earliestDaysFromNow: 1, relevanceChecks: [],
          cancellationConditions: [], messageStrategy: 'light_check_in', confidence: 0.9 }],
      };
      const ai = { extractMemory: vi.fn().mockResolvedValue(proposal) };
      const conversationRepo = new ConversationRepository(database);
      const useCase = new MemoryExtractionUseCase(conversationRepo,
        new MemoryRepository(database), new GoalRepository(database), ai as never);
      const intentRepo = new MemoryExtractionIntentRepository(database);
      const scheduler = new FollowUpSchedulerUseCase(new ScheduledActionRepository(database), {
        enqueueFollowUpExecution: async (payload: { scheduledActionId: string }) => {
          await followUpQueue.add('execute', payload, { jobId: `follow-up-${payload.scheduledActionId}` });
        },
      } as never);
      const prepared = await useCase.prepare(input);
      expect(prepared).not.toBeNull();
      await expect(intentRepo.complete(input, async () => {
        const result = await useCase.apply(input, prepared!);
        await scheduler.stage({ ...input, candidates: result.followUpCandidates });
        throw new Error('injected_after_effects');
      })).rejects.toThrow('injected_after_effects');
      expect(await db.select().from(memoryItems).where(eq(memoryItems.userId, user!.id))).toEqual([]);
      expect(await db.select().from(userGoals).where(eq(userGoals.userId, user!.id))).toEqual([]);
      expect(await db.select().from(scheduledActions).where(eq(scheduledActions.userId, user!.id))).toEqual([]);
      expect(await intentRepo.status(input)).toBe('pending');
      expect(await followUpQueue.getWaitingCount()).toBe(0);

      const original = await memoryQueue.add('extract', input,
        { jobId: `memory-extraction-${inbound!.id}` });
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
        conversationRepo, undefined, undefined, undefined, memoryQueue as never,
      );
      await cutoff.process({ name: 'cutoff' } as never);
      expect(await memoryQueue.getWaitingCount()).toBe(1);
      await original.remove();
      await cutoff.process({ name: 'cutoff' } as never);
      expect(await memoryQueue.getWaitingCount()).toBe(1);

      const processor = new MemoryExtractionProcessor(useCase, scheduler, intentRepo, conversationRepo);
      worker = new Worker(memoryQueue.name, (job) => processor.process(job as never),
        { connection, autorun: false });
      const completion = new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('memory_recovery_timeout')), 10_000);
        worker!.once('completed', () => { clearTimeout(timer); resolve(); });
        worker!.once('failed', (_job, error) => { clearTimeout(timer); reject(error); });
      });
      void worker.run();
      await completion;
      expect(await intentRepo.status(input)).toBe('complete');
      expect(await db.select().from(memoryItems).where(eq(memoryItems.userId, user!.id))).toHaveLength(1);
      expect(await db.select().from(userGoals).where(eq(userGoals.userId, user!.id))).toHaveLength(1);
      expect(await db.select().from(scheduledActions).where(eq(scheduledActions.userId, user!.id))).toHaveLength(1);
      expect(await followUpQueue.getWaitingCount()).toBe(1);
      expect(await conversationRepo.findRecoverableMemoryExtractions(new Date())).toEqual([]);
      await processor.process({ id: 'duplicate-memory', data: input } as never);
      expect(ai.extractMemory).toHaveBeenCalledTimes(2);
      expect(await db.select().from(memoryItems).where(eq(memoryItems.userId, user!.id))).toHaveLength(1);
      expect(await db.select().from(scheduledActions).where(eq(scheduledActions.userId, user!.id))).toHaveLength(1);
      for (const [turns] of ai.extractMemory.mock.calls) {
        expect(JSON.stringify(turns)).not.toContain('later private message');
      }
    } finally {
      if (worker) await worker.close();
      await memoryQueue.obliterate({ force: true });
      await memoryQueue.close();
      await followUpQueue.obliterate({ force: true });
      await followUpQueue.close();
      if (tenantId) await client.db.delete(tenants).where(eq(tenants.id, tenantId));
      await database.onModuleDestroy();
      await client.sql.end({ timeout: 2 });
    }
  });
});
