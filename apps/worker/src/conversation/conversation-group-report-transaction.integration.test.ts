import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { Queue } from 'bullmq';
import { and, eq, sql } from 'drizzle-orm';
import {
  conversationDispatchIntents, conversationJobAdmissions, conversationTurnEffects,
  conversations, createDbClient, messages, surveyDefinitions, surveyGroupStates,
  surveyReportingCohorts, surveyWindows, teams, tenants, users,
} from '@entalent/database';
import { ConversationOrchestrator } from '@entalent/application';
import { DatabaseService } from '../database/database.service';
import { ConversationRepository } from './repositories/conversation.repository';
import { OutboxService } from './outbox.service';
import { GroupStateRepository } from '../survey/repositories/group-state.repository';

const databaseUrl = process.env['DATABASE_URL'];
const redisUrl = process.env['REDIS_URL'];
const enabled = process.env['V2_CONVERSATION_QUEUE_TEST'] === '1' && !!databaseUrl && !!redisUrl;

describe.skipIf(!enabled)('V1 group confirmation transaction on migrated PostgreSQL and Redis', () => {
  it('rolls back a confirmed group with the answer, then queues one scoped report on retry', async () => {
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
    const sendQueue = new Queue(`group-send-${randomUUID()}`, { connection });
    const reportQueue = new Queue(`group-report-${randomUUID()}`, { connection });
    let tenantId: string | undefined;
    try {
      const db = client.db;
      const [tenant] = await db.insert(tenants).values({ name: `Group report fixture ${randomUUID()}` }).returning();
      tenantId = tenant!.id;
      const [user] = await db.insert(users).values({
        tenantId, preferredName: 'Sam', timezone: 'UTC', locale: 'en',
      }).returning();
      const [team] = await db.insert(teams).values({ tenantId, name: 'Synthetic team' }).returning();
      const [definition] = await db.insert(surveyDefinitions).values({
        tenantId, name: 'Synthetic V1 definition', version: `fixture-${randomUUID()}`,
      }).returning();
      const now = Date.now();
      const [cohort] = await db.insert(surveyReportingCohorts).values({
        tenantId, teamId: team!.id, surveyDefinitionId: definition!.id,
        periodStart: new Date(now - 86_400_000), periodEnd: new Date(now + 86_400_000),
        rosterUserIds: [user!.id], openedAt: new Date(now - 60_000),
      }).returning();
      const [window] = await db.insert(surveyWindows).values({
        tenantId, userId: user!.id, surveyDefinitionId: definition!.id,
        periodStart: cohort!.periodStart, periodEnd: cohort!.periodEnd,
        reportingCohortId: cohort!.id, reportingTeamId: team!.id,
        reportingRosterUserIds: [user!.id],
      }).returning();
      const externalConversationId = `group-${randomUUID()}`;
      const [conversation] = await db.insert(conversations).values({
        tenantId, userId: user!.id, channelType: 'dev', externalConversationId,
      }).returning();
      const scope = { tenantId, userId: user!.id, conversationId: conversation!.id };
      const shownAt = new Date(now - 30_000);
      const promptAt = new Date(now - 10_000);
      const summary = 'The exact shown summary.';
      await db.insert(messages).values({
        ...scope, direction: 'outbound', senderType: 'agent', text: 'Reporting disclosure.',
        occurredAt: shownAt, sentAt: shownAt,
        metadata: { reportingDisclosureVersion: 'reporting-disclosure-v1' },
      });
      const [prompt] = await db.insert(messages).values({
        ...scope, direction: 'outbound', senderType: 'agent',
        text: `${summary} Correct?`, occurredAt: promptAt, sentAt: promptAt,
        metadata: {
          confirmationSummary: summary,
          deidentificationDecision: {
            status: 'accepted', policyVersion: 'deidentification-v1', reasons: [],
          },
        },
      }).returning();
      const [group] = await db.insert(surveyGroupStates).values({
        surveyWindowId: window!.id, tenantId, userId: user!.id,
        questionGroup: 'growth', status: 'awaiting_confirmation',
        confirmationPromptMessageId: prompt!.id,
        deidentificationDecision: {
          status: 'accepted', policyVersion: 'deidentification-v1', reasons: [],
        },
      }).returning();
      const [inbound] = await db.insert(messages).values({
        ...scope, direction: 'inbound', senderType: 'user', text: 'Yes, that is right.',
        occurredAt: new Date(now),
      }).returning();
      const requestId = randomUUID();
      const traceId = randomUUID();
      await db.insert(conversationJobAdmissions).values({
        messageId: inbound!.id, ...scope, externalWorkspaceId: 'synthetic-dev-workspace',
        externalConversationId, eventId: randomUUID(), requestId, traceId,
        queuedAt: new Date(),
      });
      const ai = {
        classifySituation: vi.fn(async () => ({
          primaryIntent: 'casual_conversation', secondaryIntents: [], emotionalState: [],
          urgency: 'low', confidence: 0.9, surveyAllowed: true,
          requiresSafetyCheck: false, reasoningSummary: 'synthetic', reminderRequest: null,
          dialogueAct: 'acknowledgement', latestUserSubstance: null, topicAnchor: 'growth',
        })),
        interpretConfirmationResponse: vi.fn(async () => ({ verdict: 'agree' })),
        generateResponse: vi.fn(async () => ({
          text: 'Thank you for confirming.', confidence: 0.9, containsSurveyProbe: false,
        })),
      };
      const repo = new ConversationRepository(transactionDb);
      const groupRepo = new GroupStateRepository(transactionDb);
      const surveyRepo = {
        findAwaitingConfirmationGroups: groupRepo.findAwaitingConfirmationGroups.bind(groupRepo),
        confirmGroupState: groupRepo.confirmGroupState.bind(groupRepo),
        findTeamByMemberId: async () => ({ teamId: team!.id, reportingCohortId: cohort!.id }),
        findQuestionsForWindow: async () => [],
        findPendingConfirmationGroups: async () => [],
      };
      const recordTurn = repo.recordCommittedTurn.bind(repo);
      vi.spyOn(repo, 'recordCommittedTurn')
        .mockRejectedValueOnce(new Error('synthetic_pre_turn_effect_failure'))
        .mockImplementation(recordTurn);
      const queueOutbox = new OutboxService(
        sendQueue as never, {} as never, {} as never, {} as never,
        reportQueue as never, {} as never, {} as never,
      );
      let failReportEnqueue = true;
      const outbox = {
        enqueueMessageSend: queueOutbox.enqueueMessageSend.bind(queueOutbox),
        enqueueGroupReport: async (payload: Parameters<OutboxService['enqueueGroupReport']>[0]) => {
          if (failReportEnqueue) {
            failReportEnqueue = false;
            throw new Error('synthetic_group_report_enqueue_failure');
          }
          await queueOutbox.enqueueGroupReport(payload);
        },
        enqueueMemoryExtraction: async () => undefined,
        enqueueStyleAnalysis: async () => undefined,
        enqueueSurveyEvidence: async () => undefined,
        enqueueProfileHydration: async () => undefined,
        enqueueFollowUpExecution: async () => undefined,
      };
      const orchestrator = new ConversationOrchestrator(
        repo, ai as never, outbox as never, undefined, surveyRepo as never,
        undefined, undefined, { isEnabled: async () => true } as never,
        undefined, undefined, undefined, undefined, undefined,
        { run: (callback) => transactionDb.withTransaction(callback) },
      );
      const input = {
        messageId: inbound!.id, ...scope,
        externalWorkspaceId: 'synthetic-dev-workspace', externalConversationId,
        eventId: randomUUID(), requestId, traceId,
      };

      await expect(orchestrator.orchestrate(input)).rejects.toThrow('synthetic_pre_turn_effect_failure');
      const [rolledBackGroup] = await db.select().from(surveyGroupStates)
        .where(eq(surveyGroupStates.id, group!.id));
      expect(rolledBackGroup?.status).toBe('awaiting_confirmation');
      expect(await db.select().from(conversationTurnEffects)
        .where(eq(conversationTurnEffects.inboundMessageId, inbound!.id))).toHaveLength(0);
      expect(await db.select().from(messages).where(and(
        eq(messages.conversationId, conversation!.id),
        eq(messages.direction, 'outbound'),
        sql`${messages.metadata}->>'sourceInboundMessageId' = ${inbound!.id}`,
      ))).toHaveLength(0);
      expect(await reportQueue.getJobs(['waiting', 'delayed'])).toHaveLength(0);

      await expect(orchestrator.orchestrate(input))
        .rejects.toThrow('synthetic_group_report_enqueue_failure');

      const [confirmed] = await db.select().from(surveyGroupStates)
        .where(eq(surveyGroupStates.id, group!.id));
      expect(confirmed?.status).toBe('confirmed');
      expect(confirmed?.confirmationMessageId).toBe(inbound!.id);
      const [intent] = await db.select().from(conversationDispatchIntents).where(and(
        eq(conversationDispatchIntents.inboundMessageId, inbound!.id),
        eq(conversationDispatchIntents.kind, 'group_report'),
      ));
      expect(intent?.targetId).toBe(group!.id);
      expect(intent?.lastQueuedAt).toBeNull();
      expect(await repo.findUnqueuedCommittedGroupReports({
        inboundMessageId: inbound!.id, ...scope,
      })).toEqual([{
        groupStateId: group!.id, reportingCohortId: cohort!.id,
        teamId: team!.id, questionGroup: 'growth',
      }]);
      expect(await reportQueue.getJobs(['waiting'])).toHaveLength(0);
      expect(await orchestrator.resumeCommittedTurn(input)).toBe(true);
      expect(await repo.findUnqueuedCommittedGroupReports({
        inboundMessageId: inbound!.id, ...scope,
      })).toEqual([]);
      const reportJob = await reportQueue.getJob(`group-report-${group!.id}`);
      expect(reportJob?.data).toMatchObject({
        sourceGroupStateId: group!.id, reportingCohortId: cohort!.id,
        tenantId, teamId: team!.id, questionGroup: 'growth',
      });
      expect(JSON.stringify(reportJob?.data)).not.toContain(summary);
      expect(await orchestrator.resumeCommittedTurn(input)).toBe(true);
      expect(ai.interpretConfirmationResponse).toHaveBeenCalledTimes(2);
      expect(await reportQueue.getJobs(['waiting'])).toHaveLength(1);
    } finally {
      await Promise.all([sendQueue.obliterate({ force: true }), reportQueue.obliterate({ force: true })]);
      await Promise.all([sendQueue.close(), reportQueue.close()]);
      if (tenantId) await client.db.delete(tenants).where(eq(tenants.id, tenantId));
      await transactionDb.onModuleDestroy();
      await client.sql.end({ timeout: 2 });
    }
  }, 20_000);
});
