import { randomUUID } from 'node:crypto';
import { Queue } from 'bullmq';
import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import {
  conversationDispatchIntents, conversationJobAdmissions, conversationTurnEffects,
  conversations, createDbClient, messages, surveyDefinitions, surveyGroupStates,
  surveyReportingCohorts, surveyWindows, teams, tenants, users,
} from '@entalent/database';
import { DatabaseService } from '../database/database.service';
import { ConversationRepository } from '../conversation/repositories/conversation.repository';
import { QuestionCutoffProcessor } from './question-cutoff.processor';
import { GroupReportProcessor } from './group-report.processor';

const databaseUrl = process.env['DATABASE_URL'];
const redisUrl = process.env['REDIS_URL'];
const enabled = process.env['V2_CONVERSATION_QUEUE_TEST'] === '1' && !!databaseUrl && !!redisUrl;

describe.skipIf(!enabled)('committed V1 group-report recovery on PostgreSQL and Redis', () => {
  it('recovers a lost job and records completion after the processor returns', async () => {
    const postgres = new URL(databaseUrl!);
    const redis = new URL(redisUrl!);
    if (!['127.0.0.1', 'localhost'].includes(postgres.hostname) || !postgres.port
      || !['127.0.0.1', 'localhost'].includes(redis.hostname) || redis.pathname !== '/15') {
      throw new Error('isolated_postgres_and_redis_required');
    }
    const client = createDbClient(databaseUrl!);
    const database = new DatabaseService({ get: () => databaseUrl } as never);
    database.onModuleInit();
    const queue = new Queue(`group-report-recovery-${randomUUID()}`, {
      connection: { host: redis.hostname, port: Number(redis.port), db: 15 },
    });
    let tenantId: string | undefined;
    try {
      const db = client.db;
      const [tenant] = await db.insert(tenants).values({ name: `Report ${randomUUID()}` }).returning();
      tenantId = tenant!.id;
      const [user] = await db.insert(users).values({ tenantId }).returning();
      const [team] = await db.insert(teams).values({ tenantId, name: 'Recovery team' }).returning();
      const [definition] = await db.insert(surveyDefinitions).values({
        tenantId, name: 'Recovery survey', version: '1',
      }).returning();
      const [conversation] = await db.insert(conversations).values({
        tenantId, userId: user!.id, channelType: 'slack', externalConversationId: 'D1',
      }).returning();
      const now = new Date();
      const shownAt = new Date(now.getTime() - 15 * 60_000);
      const scope = { tenantId, userId: user!.id, conversationId: conversation!.id };
      const [inbound] = await db.insert(messages).values({
        ...scope, direction: 'inbound', senderType: 'user', text: 'Yes', occurredAt: now,
      }).returning();
      const [outbound] = await db.insert(messages).values({
        ...scope, direction: 'outbound', senderType: 'agent', text: 'Thanks', occurredAt: now,
        metadata: { sourceInboundMessageId: inbound!.id },
      }).returning();
      const [prompt] = await db.insert(messages).values({
        ...scope, direction: 'outbound', senderType: 'agent', text: 'Confirm?',
        occurredAt: shownAt, sentAt: shownAt, metadata: { confirmationSummary: 'Confirmed' },
      }).returning();
      await db.insert(conversationJobAdmissions).values({
        messageId: inbound!.id, ...scope, externalWorkspaceId: 'T1',
        externalConversationId: 'D1', eventId: randomUUID(),
        requestId: randomUUID(), traceId: randomUUID(),
      });
      await db.insert(conversationTurnEffects).values({
        inboundMessageId: inbound!.id, outboundMessageId: outbound!.id, ...scope,
      });
      const [cohort] = await db.insert(surveyReportingCohorts).values({
        tenantId, teamId: team!.id, surveyDefinitionId: definition!.id,
        periodStart: new Date(now.getTime() - 86_400_000),
        periodEnd: new Date(now.getTime() + 86_400_000),
        rosterUserIds: [user!.id], openedAt: shownAt,
      }).returning();
      const [window] = await db.insert(surveyWindows).values({
        tenantId, userId: user!.id, surveyDefinitionId: definition!.id,
        periodStart: cohort!.periodStart, periodEnd: cohort!.periodEnd,
        reportingCohortId: cohort!.id, reportingTeamId: team!.id,
        reportingRosterUserIds: [user!.id],
      }).returning();
      const [state] = await db.insert(surveyGroupStates).values({
        surveyWindowId: window!.id, tenantId, userId: user!.id,
        questionGroup: 'growth', status: 'confirmed', aiSummary: 'Confirmed',
        deidentificationDecision: {
          status: 'accepted', policyVersion: 'deidentification-v1', reasons: [],
        },
        confirmedAt: now, reportingDisclosureVersion: 'reporting-disclosure-v1',
        reportingDisclosureShownAt: shownAt,
        confirmationMessageId: inbound!.id, confirmationPromptMessageId: prompt!.id,
      }).returning();
      const [intent] = await db.insert(conversationDispatchIntents).values({
        inboundMessageId: inbound!.id, kind: 'group_report', targetId: state!.id,
      }).returning();
      await db.update(conversationDispatchIntents).set({
        lastQueuedAt: new Date(now.getTime() - 10 * 60_000),
      }).where(eq(conversationDispatchIntents.id, intent!.id));
      const repository = new ConversationRepository(database);
      const candidates = await repository.findRecoverableGroupReports(now);
      expect(candidates).toEqual([expect.objectContaining({
        intentId: intent!.id, sourceGroupStateId: state!.id,
        reportingCohortId: cohort!.id, tenantId, userId: user!.id,
      })]);
      await expect(repository.completeGroupReportIntent({
        sourceGroupStateId: state!.id, reportingCohortId: cohort!.id,
        tenantId: randomUUID(), teamId: team!.id, questionGroup: 'growth',
      })).rejects.toThrow('group_report_intent_scope_mismatch');
      vi.spyOn(repository, 'isUserRuntimeEligible').mockResolvedValue(true);
      const cutoff = new QuestionCutoffProcessor(
        { execute: async () => ({ tenantsProcessed: 0, expiredQuestionCount: 0, overdueReplyCount: 0 }) } as never,
        { execute: async () => ({ usersScanned: 0, finalizedQuestionCount: 0, failedUserCount: 0 }) } as never,
        {} as never,
        { findUndispatchedTimelyQuestionReplies: async () => [],
          findQueuedTimelyQuestionRepliesWithoutReceipt: async () => [] } as never,
        { add: vi.fn() } as never, repository,
        undefined, undefined, undefined, undefined, undefined, undefined, queue as never,
      );
      await cutoff.process({ name: 'cutoff' } as never);
      const recovered = await queue.getJob(`group-report-${state!.id}`);
      expect(recovered?.data).toMatchObject({
        sourceGroupStateId: state!.id, reportingCohortId: cohort!.id,
      });
      const useCase = { execute: vi.fn().mockResolvedValue({
        shouldSend: false, managerSlackUserId: null, message: '',
        teamScore: 0, confirmedCount: 1,
      }) };
      const processor = new GroupReportProcessor(
        useCase as never, {} as never, {} as never, {} as never, repository,
      );
      await processor.process(recovered as never);
      expect(useCase.execute).toHaveBeenCalledOnce();
      const [completed] = await db.select().from(conversationDispatchIntents)
        .where(eq(conversationDispatchIntents.id, intent!.id));
      expect(completed?.completedAt).toBeInstanceOf(Date);
      expect(await repository.findRecoverableGroupReports(new Date())).toEqual([]);
    } finally {
      await queue.obliterate({ force: true });
      await queue.close();
      if (tenantId) await client.db.delete(tenants).where(eq(tenants.id, tenantId));
      await database.onModuleDestroy();
      await client.sql.end({ timeout: 2 });
    }
  });
});
