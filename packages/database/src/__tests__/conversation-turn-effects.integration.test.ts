import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import {
  conversationDispatchIntents,
  conversationJobAdmissions,
  conversationMessageSendAttempts,
  conversationTurnEffects,
  conversations,
  messages,
  scheduledActions,
  surveyDefinitions,
  surveyGroupStates,
  surveyReportingCohorts,
  surveyWindows,
  teams,
  tenants,
  users,
} from '../schema';
import { closeTestDb, describeIntegration, getTestDb, runMigrationsOnce } from './integration-setup';

describeIntegration('content-free conversation turn commit (integration)', () => {
  let tenantId: string;

  beforeAll(async () => runMigrationsOnce());
  afterAll(async () => {
    const { db } = getTestDb();
    if (tenantId) await db.delete(tenants).where(eq(tenants.id, tenantId));
    await closeTestDb();
  });

  it('binds one scoped inbound and outbound, and only identifier dispatch targets', async () => {
    const { db } = getTestDb();
    const [tenant] = await db.insert(tenants).values({ name: `Turn ${randomUUID()}` }).returning();
    tenantId = tenant!.id;
    const [user, otherUser] = await db.insert(users).values([{ tenantId }, { tenantId }]).returning();
    const [conversation] = await db.insert(conversations).values({
      tenantId, userId: user!.id, channelType: 'slack', externalConversationId: randomUUID(),
    }).returning();
    const scope = { tenantId, userId: user!.id, conversationId: conversation!.id };
    const now = new Date();
    const [inbound] = await db.insert(messages).values({
      ...scope, direction: 'inbound', senderType: 'user', text: 'Private inbound', occurredAt: now,
    }).returning();
    const [outbound, mismatchedOutbound] = await db.insert(messages).values([
      { ...scope, direction: 'outbound', senderType: 'agent', text: 'Private response',
        occurredAt: now, metadata: { sourceInboundMessageId: inbound!.id } },
      { ...scope, direction: 'outbound', senderType: 'agent', text: 'Different source',
        occurredAt: now, metadata: { sourceInboundMessageId: randomUUID() } },
    ]).returning();
    await db.insert(conversationJobAdmissions).values({
      messageId: inbound!.id, ...scope,
      externalWorkspaceId: 'T-workspace', externalConversationId: 'D-channel',
      eventId: randomUUID(), requestId: randomUUID(), traceId: randomUUID(),
    });

    await expect(db.insert(conversationTurnEffects).values({
      inboundMessageId: inbound!.id, ...scope, outboundMessageId: mismatchedOutbound!.id,
    })).rejects.toThrow(/conversation_turn_effect_scope_mismatch/);
    await expect(db.insert(conversationTurnEffects).values({
      inboundMessageId: inbound!.id, ...scope, userId: otherUser!.id,
      outboundMessageId: outbound!.id,
    })).rejects.toThrow(/conversation_turn_effect_scope_mismatch/);
    await db.insert(conversationTurnEffects).values({
      inboundMessageId: inbound!.id, ...scope, outboundMessageId: outbound!.id,
    });
    await expect(db.update(conversationTurnEffects).set({ outboundMessageId: mismatchedOutbound!.id })
      .where(eq(conversationTurnEffects.inboundMessageId, inbound!.id)))
      .rejects.toThrow(/conversation_turn_effect_immutable/);
    await expect(db.delete(conversationTurnEffects)
      .where(eq(conversationTurnEffects.inboundMessageId, inbound!.id)))
      .rejects.toThrow(/conversation_turn_effect_immutable/);

    await expect(db.insert(conversationDispatchIntents).values({
      inboundMessageId: inbound!.id, kind: 'message_send', targetId: mismatchedOutbound!.id,
    })).rejects.toThrow(/conversation_dispatch_intent_scope_mismatch/);
    await db.insert(conversationDispatchIntents).values([
      { inboundMessageId: inbound!.id, kind: 'message_send', targetId: outbound!.id },
      { inboundMessageId: inbound!.id, kind: 'survey_evidence', targetId: inbound!.id },
    ]);
    const [unrelatedAction, followUp] = await db.insert(scheduledActions).values([
      { ...scope, type: 'user_reminder', intent: 'Other source', dueAt: now,
        sourceMessageIds: [randomUUID()] },
      { ...scope, type: 'user_reminder', intent: 'Current source', dueAt: now,
        sourceMessageIds: [inbound!.id] },
    ]).returning();
    await expect(db.insert(conversationDispatchIntents).values({
      inboundMessageId: inbound!.id, kind: 'follow_up_execution', targetId: unrelatedAction!.id,
    })).rejects.toThrow(/conversation_dispatch_intent_scope_mismatch/);
    await db.insert(conversationDispatchIntents).values({
      inboundMessageId: inbound!.id, kind: 'follow_up_execution', targetId: followUp!.id,
    });
    const shownAt = new Date(now.getTime() - 60_000);
    const [team] = await db.insert(teams).values({ tenantId, name: 'Test team' }).returning();
    const [definition] = await db.insert(surveyDefinitions).values({
      tenantId, name: 'Test definition', version: '1',
    }).returning();
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
    const confirmationSummary = 'A summary shown to the employee.';
    const [prompt] = await db.insert(messages).values({
      ...scope, direction: 'outbound', senderType: 'agent',
      text: `${confirmationSummary} Correct?`, metadata: { confirmationSummary },
      occurredAt: shownAt, sentAt: shownAt,
    }).returning();
    const [group] = await db.insert(surveyGroupStates).values({
      surveyWindowId: window!.id, tenantId, userId: user!.id,
      questionGroup: 'growth', status: 'confirmed', aiSummary: confirmationSummary,
      deidentificationDecision: { status: 'accepted', policyVersion: 'deidentification-v1', reasons: [] },
      confirmedAt: now, reportingDisclosureVersion: 'reporting-disclosure-v1',
      reportingDisclosureShownAt: shownAt,
      confirmationMessageId: inbound!.id, confirmationPromptMessageId: prompt!.id,
    }).returning();
    await expect(db.insert(conversationDispatchIntents).values({
      inboundMessageId: inbound!.id, kind: 'group_report', targetId: randomUUID(),
    })).rejects.toThrow(/conversation_dispatch_intent_scope_mismatch/);
    await db.insert(conversationDispatchIntents).values({
      inboundMessageId: inbound!.id, kind: 'group_report', targetId: group!.id,
    });
    await expect(db.insert(conversationDispatchIntents).values({
      inboundMessageId: inbound!.id, kind: 'survey_evidence', targetId: randomUUID(),
    })).rejects.toThrow(/conversation_dispatch_intent_scope_mismatch/);
    const [sendIntent] = await db.select().from(conversationDispatchIntents)
      .where(eq(conversationDispatchIntents.kind, 'message_send'));
    await db.update(conversationDispatchIntents).set({ lastQueuedAt: now })
      .where(eq(conversationDispatchIntents.id, sendIntent!.id));
    await expect(db.update(conversationDispatchIntents).set({ targetId: inbound!.id })
      .where(eq(conversationDispatchIntents.id, sendIntent!.id)))
      .rejects.toThrow(/conversation_dispatch_intent_immutable/);
    const [evidenceIntent] = await db.select().from(conversationDispatchIntents)
      .where(eq(conversationDispatchIntents.kind, 'survey_evidence'));
    const queuedAt = new Date(now.getTime() + 1_000);
    const completedAt = new Date(now.getTime() + 2_000);
    await db.update(conversationDispatchIntents).set({ lastQueuedAt: queuedAt })
      .where(eq(conversationDispatchIntents.id, evidenceIntent!.id));
    await db.update(conversationDispatchIntents).set({ completedAt })
      .where(eq(conversationDispatchIntents.id, evidenceIntent!.id));
    await expect(db.update(conversationDispatchIntents).set({ completedAt: new Date(now.getTime() + 3_000) })
      .where(eq(conversationDispatchIntents.id, evidenceIntent!.id)))
      .rejects.toThrow(/conversation_dispatch_intent_immutable/);

    await expect(db.insert(conversationMessageSendAttempts).values({
      inboundMessageId: inbound!.id, outboundMessageId: mismatchedOutbound!.id,
    })).rejects.toThrow(/conversation_message_send_attempt_scope_mismatch/);
    await db.insert(conversationMessageSendAttempts).values({
      inboundMessageId: inbound!.id, outboundMessageId: outbound!.id,
    });
    await expect(db.update(conversationMessageSendAttempts).set({ startedAt: new Date(now.getTime() + 1_000) })
      .where(eq(conversationMessageSendAttempts.outboundMessageId, outbound!.id)))
      .rejects.toThrow(/conversation_message_send_attempt_immutable/);
    await expect(db.delete(conversationMessageSendAttempts)
      .where(eq(conversationMessageSendAttempts.outboundMessageId, outbound!.id)))
      .rejects.toThrow(/conversation_message_send_attempt_immutable/);

    const columns = await db.execute(sql`select column_name from information_schema.columns
      where table_schema = 'public' and table_name in
        ('conversation_turn_effects', 'conversation_dispatch_intents', 'conversation_message_send_attempts')`);
    expect(columns.map((row) => row['column_name'])).not.toEqual(expect.arrayContaining([
      'text', 'response_text', 'summary', 'payload', 'metadata',
    ]));
    expect((await db.select().from(conversationDispatchIntents))).toHaveLength(4);
  });
});
