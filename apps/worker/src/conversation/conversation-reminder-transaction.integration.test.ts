import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { Queue } from 'bullmq';
import { and, eq } from 'drizzle-orm';
import {
  conversationDispatchIntents, conversationJobAdmissions, conversationTurnEffects,
  conversations, createDbClient, messages, scheduledActions, tenants, users,
} from '@entalent/database';
import { ConversationOrchestrator } from '@entalent/application';
import { DatabaseService } from '../database/database.service';
import { ConversationRepository } from './repositories/conversation.repository';
import { OutboxService } from './outbox.service';
import { ScheduledActionRepository } from '../followup/repositories/scheduled-action.repository';

const databaseUrl = process.env['DATABASE_URL'];
const redisUrl = process.env['REDIS_URL'];
const enabled = process.env['V2_CONVERSATION_QUEUE_TEST'] === '1' && !!databaseUrl && !!redisUrl;

describe.skipIf(!enabled)('committed reminder on migrated PostgreSQL and Redis', () => {
  it('rolls back the action and answer together, then queues one scoped follow-up on retry', async () => {
    const dbUrl = new URL(databaseUrl!);
    const redis = new URL(redisUrl!);
    if (!['127.0.0.1', 'localhost'].includes(dbUrl.hostname) || !dbUrl.port
      || !['127.0.0.1', 'localhost'].includes(redis.hostname) || redis.pathname !== '/15') {
      throw new Error('isolated_postgres_and_redis_required');
    }
    const client = createDbClient(databaseUrl!);
    const transactionDb = new DatabaseService({ get: () => databaseUrl } as never);
    transactionDb.onModuleInit();
    const connection = {
      host: redis.hostname, port: Number(redis.port) || 6379, db: 15,
      maxRetriesPerRequest: null,
    };
    const sendQueue = new Queue(`reminder-send-${randomUUID()}`, { connection });
    const followUpQueue = new Queue(`reminder-follow-up-${randomUUID()}`, { connection });
    let tenantId: string | undefined;
    try {
      const db = client.db;
      const [tenant] = await db.insert(tenants).values({ name: `Reminder fixture ${randomUUID()}` }).returning();
      tenantId = tenant!.id;
      const [user] = await db.insert(users).values({
        tenantId, preferredName: 'Sam', timezone: 'UTC', locale: 'en',
      }).returning();
      const externalConversationId = `reminder-${randomUUID()}`;
      const [conversation] = await db.insert(conversations).values({
        tenantId, userId: user!.id, channelType: 'dev', externalConversationId,
      }).returning();
      const [inbound] = await db.insert(messages).values({
        tenantId, userId: user!.id, conversationId: conversation!.id,
        direction: 'inbound', senderType: 'user', text: 'Remind me to send the report.',
        occurredAt: new Date(),
      }).returning();
      const requestId = randomUUID();
      const traceId = randomUUID();
      await db.insert(conversationJobAdmissions).values({
        messageId: inbound!.id, tenantId, userId: user!.id,
        conversationId: conversation!.id, externalWorkspaceId: 'synthetic-dev-workspace',
        externalConversationId, eventId: randomUUID(), requestId, traceId,
        queuedAt: new Date(),
      });
      const dueAt = new Date(Date.now() + 3_600_000);
      const ai = {
        classifySituation: vi.fn(async () => ({
          primaryIntent: 'casual_conversation', secondaryIntents: [], emotionalState: [],
          urgency: 'low', confidence: 0.9, surveyAllowed: false,
          requiresSafetyCheck: false, reasoningSummary: 'synthetic',
          reminderRequest: { intent: 'send the report', dueAt: dueAt.toISOString() },
          dialogueAct: 'request', latestUserSubstance: 'send the report', topicAnchor: null,
        })),
        generateResponse: vi.fn(async () => ({
          text: 'I will remind you.', confidence: 0.9, containsSurveyProbe: false,
        })),
      };
      const repo = new ConversationRepository(transactionDb);
      const recordTurn = repo.recordCommittedTurn.bind(repo);
      vi.spyOn(repo, 'recordCommittedTurn')
        .mockRejectedValueOnce(new Error('synthetic_pre_turn_effect_failure'))
        .mockImplementation(recordTurn);
      const outbox = new OutboxService(
        sendQueue as never, {} as never, followUpQueue as never,
        {} as never, {} as never, {} as never, {} as never,
      );
      const orchestrator = new ConversationOrchestrator(
        repo, ai as never, outbox, undefined, undefined,
        undefined, undefined, { isEnabled: async () => false } as never,
        new ScheduledActionRepository(transactionDb),
        undefined, undefined, undefined, undefined,
        { run: (callback) => transactionDb.withTransaction(callback) },
      );
      const input = {
        messageId: inbound!.id, tenantId, userId: user!.id,
        conversationId: conversation!.id,
        externalWorkspaceId: 'synthetic-dev-workspace', externalConversationId,
        eventId: randomUUID(), requestId, traceId,
      };

      await expect(orchestrator.orchestrate(input)).rejects.toThrow('synthetic_pre_turn_effect_failure');
      expect(await db.select().from(scheduledActions).where(eq(scheduledActions.tenantId, tenantId)))
        .toHaveLength(0);
      expect(await db.select().from(conversationTurnEffects)
        .where(eq(conversationTurnEffects.inboundMessageId, inbound!.id))).toHaveLength(0);
      expect(await db.select().from(messages).where(and(
        eq(messages.conversationId, conversation!.id), eq(messages.direction, 'outbound'),
      ))).toHaveLength(0);

      await orchestrator.orchestrate(input);

      const [action] = await db.select().from(scheduledActions).where(eq(scheduledActions.tenantId, tenantId));
      expect(action?.sourceMessageIds).toEqual([inbound!.id]);
      const intents = await db.select().from(conversationDispatchIntents).where(and(
        eq(conversationDispatchIntents.inboundMessageId, inbound!.id),
        eq(conversationDispatchIntents.kind, 'follow_up_execution'),
      ));
      expect(intents).toHaveLength(1);
      expect(intents[0]?.targetId).toBe(action!.id);
      expect(intents[0]?.lastQueuedAt).toBeInstanceOf(Date);
      const job = await followUpQueue.getJob(`follow-up-${action!.id}-${dueAt.getTime()}`);
      expect(job?.data).toMatchObject({ scheduledActionId: action!.id, tenantId, userId: user!.id });
      expect(await followUpQueue.getJobs(['delayed'])).toHaveLength(1);
      expect(ai.generateResponse).toHaveBeenCalledTimes(2);
    } finally {
      await Promise.all([sendQueue.obliterate({ force: true }), followUpQueue.obliterate({ force: true })]);
      await Promise.all([sendQueue.close(), followUpQueue.close()]);
      if (tenantId) await client.db.delete(tenants).where(eq(tenants.id, tenantId));
      await transactionDb.onModuleDestroy();
      await client.sql.end({ timeout: 2 });
    }
  }, 20_000);
});
