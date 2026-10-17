import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { Queue, Worker } from 'bullmq';
import {
  channelAccounts, conversationDispatchIntents, conversationJobAdmissions,
  conversationTurnEffects, conversations, createDbClient, messages, tenants, users,
} from '@entalent/database';
import { ProfileHydrationUseCase } from '@entalent/application';
import { DatabaseService } from '../database/database.service';
import { ConversationRepository } from '../conversation/repositories/conversation.repository';
import { UserProfileRepository } from './user-profile.repository';
import { ProfileHydrationProcessor } from './profile-hydration.processor';
import { QuestionCutoffProcessor } from '../survey/question-cutoff.processor';

const databaseUrl = process.env['DATABASE_URL'];
const redisUrl = process.env['REDIS_URL'];
const enabled = process.env['V2_CONVERSATION_QUEUE_TEST'] === '1' && !!databaseUrl;

describe.skipIf(!enabled)('committed profile hydration on migrated PostgreSQL', () => {
  it('rolls back profile changes with a missing completion receipt and finishes once on retry', async () => {
    const target = new URL(databaseUrl!);
    if (!['127.0.0.1', 'localhost'].includes(target.hostname) || !target.port) {
      throw new Error('isolated_postgres_required');
    }
    const client = createDbClient(databaseUrl!);
    const database = new DatabaseService({ get: () => databaseUrl } as never);
    database.onModuleInit();
    let tenantId: string | undefined;
    let profileQueue: Queue | undefined;
    let profileWorker: Worker | undefined;
    try {
      const db = client.db;
      const [tenant] = await db.insert(tenants)
        .values({ name: `Profile recovery ${randomUUID()}` }).returning();
      tenantId = tenant!.id;
      const [user] = await db.insert(users).values({ tenantId }).returning();
      const [conversation] = await db.insert(conversations).values({
        tenantId, userId: user!.id, channelType: 'dev', externalConversationId: 'D1',
      }).returning();
      const [account] = await db.insert(channelAccounts).values({
        tenantId, userId: user!.id, channelType: 'dev',
        externalWorkspaceId: 'T1', externalUserId: `U-${randomUUID()}`,
      }).returning();
      const [inbound, outbound] = await db.insert(messages).values([
        { tenantId, userId: user!.id, conversationId: conversation!.id,
          direction: 'inbound', senderType: 'user', text: 'Hello', occurredAt: new Date() },
        { tenantId, userId: user!.id, conversationId: conversation!.id,
          direction: 'outbound', senderType: 'agent', text: 'Hi', occurredAt: new Date(),
          metadata: { sourceInboundMessageId: '' } },
      ]).returning();
      await db.update(messages).set({ metadata: { sourceInboundMessageId: inbound!.id } })
        .where(eq(messages.id, outbound!.id));
      await db.insert(conversationJobAdmissions).values({
        messageId: inbound!.id, tenantId, userId: user!.id, conversationId: conversation!.id,
        externalWorkspaceId: 'T1', externalConversationId: 'D1',
        eventId: randomUUID(), requestId: randomUUID(), traceId: randomUUID(),
      });
      await db.insert(conversationTurnEffects).values({
        inboundMessageId: inbound!.id, outboundMessageId: outbound!.id,
        tenantId, userId: user!.id, conversationId: conversation!.id,
      });
      const oldQueuedAt = new Date(Date.now() - 10 * 60_000);
      await db.insert(conversationDispatchIntents).values({
        inboundMessageId: inbound!.id, kind: 'profile_hydration',
        targetId: inbound!.id,
      });
      await db.update(conversationDispatchIntents).set({ lastQueuedAt: oldQueuedAt })
        .where(eq(conversationDispatchIntents.inboundMessageId, inbound!.id));
      const input = {
        inboundMessageId: inbound!.id, tenantId, userId: user!.id,
        channelType: 'dev', externalWorkspaceId: 'T1',
      };
      const repository = new UserProfileRepository(database);
      const external = { fetchProfile: vi.fn().mockResolvedValue({
        externalUserId: account!.externalUserId, displayName: 'Sam', timezone: 'Europe/Warsaw',
      }), fetchTimezone: vi.fn() };
      const useCase = new ProfileHydrationUseCase(external, repository);
      const conversationRepo = new ConversationRepository(database);
      expect((await conversationRepo.findRecoverableProfileHydrations(new Date()))
        .map((candidate) => candidate.inboundMessageId)).toContain(inbound!.id);

      const outcome = vi.spyOn(repository, 'recordProfileHydrationOutcome')
        .mockRejectedValueOnce(new Error('receipt unavailable'));
      await expect(useCase.execute(input)).rejects.toThrow('receipt unavailable');
      outcome.mockRestore();
      const [afterFailure] = await db.select().from(users).where(eq(users.id, user!.id));
      expect(afterFailure?.preferredName).toBeNull();
      expect(await repository.isCommittedHydrationComplete(input)).toBe(false);

      if (redisUrl) {
        const redis = new URL(redisUrl);
        if (!['127.0.0.1', 'localhost'].includes(redis.hostname) || redis.pathname !== '/15') {
          throw new Error('isolated_redis_required');
        }
        const connection = { host: redis.hostname, port: Number(redis.port), db: 15 };
        profileQueue = new Queue(`profile-recovery-${randomUUID()}`, { connection });
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
          profileQueue as never,
        );
        await cutoff.process({ name: 'cutoff' } as never);
        expect(await profileQueue.getWaitingCount()).toBe(1);
        profileWorker = new Worker(profileQueue.name,
          async (job) => new ProfileHydrationProcessor(useCase).process(job as never),
          { connection, autorun: false });
        const completion = new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('profile_recovery_timeout')), 10_000);
          profileWorker!.once('completed', () => { clearTimeout(timer); resolve(); });
          profileWorker!.once('failed', (_job, error) => { clearTimeout(timer); reject(error); });
        });
        void profileWorker.run();
        await completion;
      } else {
        await useCase.execute(input);
      }
      await useCase.execute(input);
      expect(external.fetchProfile).toHaveBeenCalledTimes(2);
      const [updated] = await db.select().from(users).where(eq(users.id, user!.id));
      expect(updated?.preferredName).toBe('Sam');
      expect(updated?.timezone).toBe('Europe/Warsaw');
      expect(await repository.isCommittedHydrationComplete(input)).toBe(true);
      await expect(conversationRepo.markCommittedDispatchQueued({
        inboundMessageId: inbound!.id, tenantId, userId: user!.id,
        conversationId: conversation!.id, kind: 'profile_hydration',
      })).resolves.toBeUndefined();
      await expect(repository.isCommittedHydrationComplete({
        ...input, tenantId: randomUUID(),
      })).rejects.toThrow('profile_hydration_intent_scope_mismatch');
      await expect(db.update(conversationDispatchIntents).set({ completedAt: null })
        .where(eq(conversationDispatchIntents.inboundMessageId, inbound!.id)))
        .rejects.toThrow('conversation_dispatch_intent_immutable');
      expect(await conversationRepo.findRecoverableProfileHydrations(new Date())).toEqual([]);
      const [accountAfter] = await db.select().from(channelAccounts).where(and(
        eq(channelAccounts.id, account!.id), eq(channelAccounts.tenantId, tenantId),
      ));
      expect((accountAfter?.profileMetadata as Record<string, { attemptCount: number }>)
        .profileHydration?.attemptCount).toBe(1);
    } finally {
      if (profileWorker) await profileWorker.close();
      if (profileQueue) {
        await profileQueue.obliterate({ force: true });
        await profileQueue.close();
      }
      if (tenantId) await client.db.delete(tenants).where(eq(tenants.id, tenantId));
      await database.onModuleDestroy();
      await client.sql.end({ timeout: 2 });
    }
  });
});
