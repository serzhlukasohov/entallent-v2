import { Injectable } from '@nestjs/common';
import { eq, and, desc, gte, isNotNull, isNull, lt, lte, ne, or, sql } from 'drizzle-orm';
import { channelAccounts, conversationDispatchIntents, conversationJobAdmissions, conversationJobReceipts, conversationMessageSendAttempts, conversationTurnEffects, conversations, messages, orgOnboardingDeliveries, people, scheduledActions, surveyGroupStates, surveyReportingCohorts, surveyWindows, users } from '@entalent/database';
import { isRuntimeEligibleUser } from '@entalent/application';
import type {
  ConversationRepositoryPort,
  ConversationDispatchKind,
  ConversationRecord,
  MessageRecord,
  ReportingDisclosureReceiptRecord,
  SaveMessageParams,
} from '@entalent/application';
import { DatabaseService } from '../../database/database.service';

@Injectable()
export class ConversationRepository implements ConversationRepositoryPort {
  constructor(private readonly db: DatabaseService) {}

  async markInboundConversationJobProcessed(input: {
    messageId: string; tenantId: string; userId: string; conversationId: string;
  }): Promise<void> {
    const [message] = await this.db.client.select({ id: messages.id }).from(messages)
      .where(and(
        eq(messages.id, input.messageId),
        eq(messages.tenantId, input.tenantId),
        eq(messages.userId, input.userId),
        eq(messages.conversationId, input.conversationId),
        eq(messages.direction, 'inbound'),
        isNull(messages.deletedAt),
      )).limit(1);
    if (!message) throw new Error('conversation_job_receipt_scope_mismatch');
    await this.db.client.insert(conversationJobReceipts).values({ messageId: message.id })
      .onConflictDoNothing();
  }

  async isUserRuntimeEligible(tenantId: string, userId: string): Promise<boolean> {
    const [row] = await this.db.client.select({
      userStatus: users.status,
      deletedAt: users.deletedAt,
      personLifecycle: people.lifecycleStatus,
      pulseParticipant: people.pulseParticipant,
    }).from(users)
      .leftJoin(people, and(eq(people.id, users.id), eq(people.tenantId, users.tenantId)))
      .where(and(eq(users.id, userId), eq(users.tenantId, tenantId)))
      .limit(1);
    return row ? isRuntimeEligibleUser(row) : false;
  }

  async findOnboardingDelivery(messageId: string, tenantId: string, userId: string): Promise<{
    status: string; externalWorkspaceId: string;
  } | null> {
    const [row] = await this.db.client.select({
      status: orgOnboardingDeliveries.status,
      externalWorkspaceId: orgOnboardingDeliveries.externalWorkspaceId,
    }).from(orgOnboardingDeliveries).where(and(
      eq(orgOnboardingDeliveries.id, messageId), eq(orgOnboardingDeliveries.tenantId, tenantId),
      eq(orgOnboardingDeliveries.personId, userId),
    )).limit(1);
    return row ?? null;
  }

  async isUserOnboardingEligible(tenantId: string, userId: string, externalWorkspaceId: string): Promise<boolean> {
    const rows = await this.db.client.select({
      userStatus: users.status, deletedAt: users.deletedAt,
      personLifecycle: people.lifecycleStatus,
    }).from(people).innerJoin(users, and(eq(users.id, people.id), eq(users.tenantId, people.tenantId)))
      .innerJoin(channelAccounts, and(eq(channelAccounts.userId, people.id),
        eq(channelAccounts.tenantId, people.tenantId), eq(channelAccounts.channelType, 'slack'),
        eq(channelAccounts.linkStatus, 'linked'),
        eq(channelAccounts.externalWorkspaceId, externalWorkspaceId)))
      .where(and(eq(people.id, userId), eq(people.tenantId, tenantId))).limit(2);
    return rows.length === 1 && rows[0].userStatus === 'active' &&
      rows[0].deletedAt === null && rows[0].personLifecycle === 'active';
  }

  async claimOnboardingDelivery(messageId: string, tenantId: string, userId: string): Promise<boolean> {
    const rows = await this.db.client.update(orgOnboardingDeliveries).set({
      status: 'sending', attemptCount: sql`${orgOnboardingDeliveries.attemptCount} + 1`,
      lastAttemptAt: new Date(), updatedAt: new Date(),
    }).where(and(
      eq(orgOnboardingDeliveries.id, messageId), eq(orgOnboardingDeliveries.tenantId, tenantId),
      eq(orgOnboardingDeliveries.personId, userId),
      eq(orgOnboardingDeliveries.status, 'pending'),
    )).returning({ id: orgOnboardingDeliveries.id });
    return rows.length === 1;
  }

  async completeOnboardingDelivery(messageId: string, tenantId: string, userId: string, sentAt: Date, externalMessageId: string): Promise<void> {
    await this.db.client.update(orgOnboardingDeliveries).set({
      status: 'delivered', deliveredAt: sentAt, externalMessageId, updatedAt: new Date(),
    }).where(and(
      eq(orgOnboardingDeliveries.id, messageId), eq(orgOnboardingDeliveries.tenantId, tenantId),
      eq(orgOnboardingDeliveries.personId, userId),
      ne(orgOnboardingDeliveries.status, 'delivered'),
    ));
  }

  async findById(id: string, tenantId: string): Promise<ConversationRecord | null> {
    const [row] = await this.db.client
      .select({
        id: conversations.id,
        tenantId: conversations.tenantId,
        userId: conversations.userId,
        channelType: conversations.channelType,
        externalConversationId: conversations.externalConversationId,
        status: conversations.status,
        activeTopic: conversations.activeTopic,
        userDisplayName: users.preferredName,
        userLocale: users.locale,
        userTimezone: users.timezone,
        userTimezoneUpdatedAt: users.timezoneUpdatedAt,
      })
      .from(conversations)
      .leftJoin(users, eq(conversations.userId, users.id))
      .where(and(eq(conversations.id, id), eq(conversations.tenantId, tenantId)))
      .limit(1);

    if (!row) return null;

    return {
      id: row.id,
      tenantId: row.tenantId,
      userId: row.userId,
      channelType: row.channelType,
      externalConversationId: row.externalConversationId,
      status: row.status,
      activeTopic: toConversationActiveTopic(row.activeTopic),
      userDisplayName: row.userDisplayName ?? undefined,
      userLocale: row.userLocale ?? undefined,
      userTimezone: row.userTimezone ?? undefined,
      userTimezoneUpdatedAt: row.userTimezoneUpdatedAt ?? undefined,
    };
  }

  async updateActiveTopic(
    conversationId: string,
    tenantId: string,
    userId: string,
    activeTopic: NonNullable<ConversationRecord['activeTopic']>,
  ): Promise<void> {
    await this.db.client
      .update(conversations)
      .set({ activeTopic, updatedAt: new Date() })
      .where(
        and(
          eq(conversations.id, conversationId),
          eq(conversations.tenantId, tenantId),
          eq(conversations.userId, userId),
        ),
      );
  }

  async findRecentMessages(conversationId: string, limit: number): Promise<MessageRecord[]> {
    const messageOrderKey = sql<string>`coalesce(${messages.externalMessageId}, ${messages.id}::text)`;
    const rows = await this.db.client
      .select({ message: messages })
      .from(messages)
      .innerJoin(conversations, and(
        eq(conversations.id, messages.conversationId),
        eq(conversations.tenantId, messages.tenantId),
        eq(conversations.userId, messages.userId),
      ))
      .where(and(
        eq(conversations.id, conversationId),
        isNull(messages.deletedAt),
      ))
      .orderBy(desc(messages.occurredAt), desc(messageOrderKey), desc(messages.id))
      .limit(limit);

    return rows
      .reverse()
      .map(({ message: m }) => ({
        id: m.id,
        conversationId: m.conversationId,
        tenantId: m.tenantId,
        userId: m.userId,
        direction: m.direction as 'inbound' | 'outbound',
        text: m.text,
        externalMessageId: m.externalMessageId ?? undefined,
        externalThreadId: m.externalThreadId ?? undefined,
        occurredAt: m.occurredAt,
        createdAt: m.occurredAt,
        sentAt: m.sentAt ?? undefined,
        metadata: (m.metadata as Record<string, unknown>) ?? undefined,
      }));
  }

  async findMessagesThrough(input: {
    conversationId: string;
    tenantId: string;
    userId: string;
    inboundMessageId: string;
    limit: number;
  }): Promise<MessageRecord[]> {
    const messageOrderKey = sql<string>`coalesce(${messages.externalMessageId}, ${messages.id}::text)`;
    const scope = and(
      eq(messages.conversationId, input.conversationId),
      eq(messages.tenantId, input.tenantId),
      eq(messages.userId, input.userId),
      eq(conversations.id, input.conversationId),
      eq(conversations.tenantId, input.tenantId),
      eq(conversations.userId, input.userId),
      isNull(messages.deletedAt),
    );
    const [anchor] = await this.db.client.select({
      id: messages.id,
      occurredAt: messages.occurredAt,
      externalMessageId: messages.externalMessageId,
    }).from(messages).innerJoin(conversations, and(
      eq(conversations.id, messages.conversationId),
      eq(conversations.tenantId, messages.tenantId),
      eq(conversations.userId, messages.userId),
    )).where(and(scope, eq(messages.id, input.inboundMessageId), eq(messages.direction, 'inbound')))
      .limit(1);
    if (!anchor) return [];
    const orderedExternalId = /^\d+\.\d{6}$/.test(anchor.externalMessageId ?? '')
      ? anchor.externalMessageId : null;

    const rows = await this.db.client.select({ message: messages }).from(messages)
      .innerJoin(conversations, and(
        eq(conversations.id, messages.conversationId),
        eq(conversations.tenantId, messages.tenantId),
        eq(conversations.userId, messages.userId),
      ))
      .where(and(scope, or(
        lt(messages.occurredAt, anchor.occurredAt),
        eq(messages.id, anchor.id),
        orderedExternalId ? and(
          eq(messages.occurredAt, anchor.occurredAt),
          isNotNull(messages.externalMessageId),
          sql`${messages.externalMessageId} ~ ${'^[0-9]+[.][0-9]{6}$'}`,
          lte(messages.externalMessageId, orderedExternalId),
        ) : undefined,
      )))
      .orderBy(desc(messages.occurredAt), desc(messageOrderKey), desc(messages.id))
      .limit(input.limit);

    return rows.reverse().map(({ message: m }) => ({
      id: m.id,
      conversationId: m.conversationId,
      tenantId: m.tenantId,
      userId: m.userId,
      direction: m.direction as 'inbound' | 'outbound',
      text: m.text,
      externalMessageId: m.externalMessageId ?? undefined,
      externalThreadId: m.externalThreadId ?? undefined,
      occurredAt: m.occurredAt,
      createdAt: m.occurredAt,
      sentAt: m.sentAt ?? undefined,
      metadata: (m.metadata as Record<string, unknown>) ?? undefined,
    }));
  }

  async shouldSkipInboundMessage(params: {
    messageId: string;
    tenantId: string;
    userId: string;
    conversationId: string;
    windowMs: number;
  }): Promise<boolean> {
    const selection = {
      id: messages.id,
      occurredAt: messages.occurredAt,
      receivedAt: messages.receivedAt,
      externalMessageId: messages.externalMessageId,
    };
    const scope = and(
      eq(messages.tenantId, params.tenantId),
      eq(messages.userId, params.userId),
      eq(messages.conversationId, params.conversationId),
      eq(messages.direction, 'inbound'),
      isNull(messages.deletedAt),
    );
    const [anchor] = await this.db.client
      .select(selection)
      .from(messages)
      .innerJoin(conversations, and(
        eq(conversations.id, messages.conversationId),
        eq(conversations.tenantId, messages.tenantId),
        eq(conversations.userId, messages.userId),
      ))
      .where(and(scope, eq(messages.id, params.messageId)))
      .limit(1);
    if (!anchor) return true;

    const windowEnd = new Date(anchor.occurredAt.getTime() + params.windowMs);
    const candidates = await this.db.client
      .select(selection)
      .from(messages)
      .innerJoin(conversations, and(
        eq(conversations.id, messages.conversationId),
        eq(conversations.tenantId, messages.tenantId),
        eq(conversations.userId, messages.userId),
      ))
      .where(and(
        scope,
        ne(messages.id, params.messageId),
        gte(messages.occurredAt, anchor.occurredAt),
        lte(messages.occurredAt, windowEnd),
      ));

    return candidates.some((candidate) =>
      isNewerInboundWithinWindow(anchor, candidate, params.windowMs));
  }

  async saveMessage(params: SaveMessageParams): Promise<MessageRecord> {
    const insert = this.db.client
      .insert(messages)
      .values({
        ...(params.id ? { id: params.id } : {}),
        conversationId: params.conversationId,
        tenantId: params.tenantId,
        userId: params.userId,
        direction: params.direction,
        senderType: params.direction === 'inbound' ? 'user' : 'agent',
        text: params.text,
        externalMessageId: params.externalMessageId,
        externalThreadId: params.externalThreadId,
        occurredAt: params.occurredAt ?? new Date(),
        traceId: params.traceId,
        messageType: params.messageType ?? 'text',
        metadata: params.metadata ?? {},
      });
    const inserted = params.id
      ? await insert.onConflictDoNothing().returning()
      : await insert.returning();
    const msg = inserted[0] ?? (params.id
      ? (await this.db.client.select().from(messages).where(and(
        eq(messages.id, params.id), eq(messages.tenantId, params.tenantId),
        eq(messages.conversationId, params.conversationId), isNull(messages.deletedAt),
      )).limit(1))[0]
      : null);
    const expectedSourceInboundId = params.metadata?.['sourceInboundMessageId'];
    const idempotencyMarkerMatches = !params.id || (typeof expectedSourceInboundId === 'string'
      ? (msg?.metadata as Record<string, unknown> | undefined)?.['sourceInboundMessageId'] === expectedSourceInboundId
        && msg?.text === params.text
      : params.metadata?.['onboardingDeliveryId'] === params.id
        && (msg?.metadata as Record<string, unknown> | undefined)?.['onboardingDeliveryId'] === params.id);
    if (!msg || msg.userId !== params.userId || msg.direction !== params.direction ||
      msg.messageType !== (params.messageType ?? 'text') ||
      !idempotencyMarkerMatches) {
      throw new Error('Message idempotency scope mismatch');
    }

    return {
      id: msg.id,
      conversationId: msg.conversationId,
      tenantId: msg.tenantId,
      userId: msg.userId,
      direction: msg.direction as 'inbound' | 'outbound',
      text: msg.text,
      externalMessageId: msg.externalMessageId ?? undefined,
      externalThreadId: msg.externalThreadId ?? undefined,
      occurredAt: msg.occurredAt,
      createdAt: msg.occurredAt,
      sentAt: msg.sentAt ?? undefined,
    };
  }

  async findCommittedTurnForInbound(input: {
    inboundMessageId: string; tenantId: string; userId: string; conversationId: string;
    externalWorkspaceId?: string; externalConversationId?: string;
  }): Promise<MessageRecord | null> {
    const [admission] = await this.db.client.select({ messageId: conversationJobAdmissions.messageId })
      .from(conversationJobAdmissions).where(and(
        eq(conversationJobAdmissions.messageId, input.inboundMessageId),
        eq(conversationJobAdmissions.tenantId, input.tenantId),
        eq(conversationJobAdmissions.userId, input.userId),
        eq(conversationJobAdmissions.conversationId, input.conversationId),
        ...(input.externalWorkspaceId ? [eq(conversationJobAdmissions.externalWorkspaceId, input.externalWorkspaceId)] : []),
        ...(input.externalConversationId ? [eq(conversationJobAdmissions.externalConversationId, input.externalConversationId)] : []),
      )).for('update').limit(1);
    if (!admission) {
      const [otherAdmission] = await this.db.client.select({ messageId: conversationJobAdmissions.messageId })
        .from(conversationJobAdmissions)
        .where(eq(conversationJobAdmissions.messageId, input.inboundMessageId)).limit(1);
      if (otherAdmission) throw new Error('conversation_job_admission_scope_mismatch');
      return null;
    }
    const [effect] = await this.db.client.select({ outboundMessageId: conversationTurnEffects.outboundMessageId })
      .from(conversationTurnEffects).where(and(
        eq(conversationTurnEffects.inboundMessageId, input.inboundMessageId),
        eq(conversationTurnEffects.tenantId, input.tenantId),
        eq(conversationTurnEffects.userId, input.userId),
        eq(conversationTurnEffects.conversationId, input.conversationId),
      )).limit(1);
    if (!effect) return null;
    const outbound = await this.findMessageById(effect.outboundMessageId, input.tenantId, input.conversationId);
    if (!outbound || outbound.userId !== input.userId || outbound.direction !== 'outbound') {
      throw new Error('conversation_turn_effect_outbound_missing');
    }
    return outbound;
  }

  async recordCommittedTurn(input: {
    inboundMessageId: string; outboundMessageId: string;
    tenantId: string; userId: string; conversationId: string;
    dispatchKinds: ConversationDispatchKind[];
    followUpActions?: Array<{ id: string; dueAt: Date }>;
    groupReportStateIds?: string[];
  }): Promise<void> {
    const [admission] = await this.db.client.select({ messageId: conversationJobAdmissions.messageId })
      .from(conversationJobAdmissions).where(and(
        eq(conversationJobAdmissions.messageId, input.inboundMessageId),
        eq(conversationJobAdmissions.tenantId, input.tenantId),
        eq(conversationJobAdmissions.userId, input.userId),
        eq(conversationJobAdmissions.conversationId, input.conversationId),
      )).limit(1);
    if (!admission) return;
    await this.db.client.insert(conversationTurnEffects).values(input);
    await this.db.client.insert(conversationDispatchIntents).values([
      ...input.dispatchKinds.map((kind) => ({
        inboundMessageId: input.inboundMessageId,
        kind,
        targetId: kind === 'message_send' ? input.outboundMessageId : input.inboundMessageId,
      })),
      ...(input.followUpActions ?? []).map((action) => ({
        inboundMessageId: input.inboundMessageId,
        kind: 'follow_up_execution', targetId: action.id,
      })),
      ...(input.groupReportStateIds ?? []).map((groupStateId) => ({
        inboundMessageId: input.inboundMessageId,
        kind: 'group_report', targetId: groupStateId,
      })),
    ]);
  }

  async findUnqueuedCommittedDispatchKinds(input: {
    inboundMessageId: string; tenantId: string; userId: string; conversationId: string;
  }): Promise<ConversationDispatchKind[] | null> {
    const [effect] = await this.db.client.select({ outboundMessageId: conversationTurnEffects.outboundMessageId })
      .from(conversationTurnEffects).where(and(
        eq(conversationTurnEffects.inboundMessageId, input.inboundMessageId),
        eq(conversationTurnEffects.tenantId, input.tenantId),
        eq(conversationTurnEffects.userId, input.userId),
        eq(conversationTurnEffects.conversationId, input.conversationId),
      )).limit(1);
    if (!effect) return null;
    const intents = await this.db.client.select({ kind: conversationDispatchIntents.kind })
      .from(conversationDispatchIntents).where(and(
        eq(conversationDispatchIntents.inboundMessageId, input.inboundMessageId),
        isNull(conversationDispatchIntents.lastQueuedAt),
        sql`${conversationDispatchIntents.kind} in
          ('message_send', 'memory_extraction', 'style_analysis', 'survey_evidence', 'profile_hydration')`,
      ));
    return intents.map((intent) => intent.kind as ConversationDispatchKind);
  }

  async findUnqueuedCommittedFollowUps(input: {
    inboundMessageId: string; tenantId: string; userId: string; conversationId: string;
  }): Promise<Array<{ scheduledActionId: string; dueAt: Date }> | null> {
    const [effect] = await this.db.client.select({ inboundMessageId: conversationTurnEffects.inboundMessageId })
      .from(conversationTurnEffects).where(and(
        eq(conversationTurnEffects.inboundMessageId, input.inboundMessageId),
        eq(conversationTurnEffects.tenantId, input.tenantId),
        eq(conversationTurnEffects.userId, input.userId),
        eq(conversationTurnEffects.conversationId, input.conversationId),
      )).limit(1);
    if (!effect) return null;
    const actions = await this.db.client.select({
      scheduledActionId: scheduledActions.id, dueAt: scheduledActions.dueAt,
    }).from(conversationDispatchIntents)
      .innerJoin(scheduledActions, and(
        eq(scheduledActions.id, conversationDispatchIntents.targetId),
        eq(scheduledActions.tenantId, input.tenantId),
        eq(scheduledActions.userId, input.userId),
        eq(scheduledActions.conversationId, input.conversationId),
      ))
      .where(and(
        eq(conversationDispatchIntents.inboundMessageId, input.inboundMessageId),
        eq(conversationDispatchIntents.kind, 'follow_up_execution'),
        isNull(conversationDispatchIntents.lastQueuedAt),
      ));
    return actions;
  }

  async findUnqueuedCommittedGroupReports(input: {
    inboundMessageId: string; tenantId: string; userId: string; conversationId: string;
  }): Promise<Array<{
    groupStateId: string; reportingCohortId: string; teamId: string; questionGroup: string;
  }> | null> {
    const [effect] = await this.db.client.select({ inboundMessageId: conversationTurnEffects.inboundMessageId })
      .from(conversationTurnEffects).where(and(
        eq(conversationTurnEffects.inboundMessageId, input.inboundMessageId),
        eq(conversationTurnEffects.tenantId, input.tenantId),
        eq(conversationTurnEffects.userId, input.userId),
        eq(conversationTurnEffects.conversationId, input.conversationId),
      )).limit(1);
    if (!effect) return null;
    return this.db.client.select({
      groupStateId: surveyGroupStates.id,
      reportingCohortId: surveyReportingCohorts.id,
      teamId: surveyReportingCohorts.teamId,
      questionGroup: surveyGroupStates.questionGroup,
    }).from(conversationDispatchIntents)
      .innerJoin(surveyGroupStates, and(
        eq(surveyGroupStates.id, conversationDispatchIntents.targetId),
        eq(surveyGroupStates.tenantId, input.tenantId),
        eq(surveyGroupStates.userId, input.userId),
        eq(surveyGroupStates.confirmationMessageId, input.inboundMessageId),
        eq(surveyGroupStates.status, 'confirmed'),
      ))
      .innerJoin(surveyWindows, and(
        eq(surveyWindows.id, surveyGroupStates.surveyWindowId),
        eq(surveyWindows.tenantId, input.tenantId),
        eq(surveyWindows.userId, input.userId),
      ))
      .innerJoin(surveyReportingCohorts, and(
        eq(surveyReportingCohorts.id, surveyWindows.reportingCohortId),
        eq(surveyReportingCohorts.tenantId, input.tenantId),
        eq(surveyReportingCohorts.teamId, surveyWindows.reportingTeamId),
      ))
      .where(and(
        eq(conversationDispatchIntents.inboundMessageId, input.inboundMessageId),
        eq(conversationDispatchIntents.kind, 'group_report'),
        isNull(conversationDispatchIntents.lastQueuedAt),
      ));
  }

  async markCommittedDispatchQueued(input: {
    inboundMessageId: string; tenantId: string; userId: string; conversationId: string;
    kind: ConversationDispatchKind | 'follow_up_execution' | 'group_report';
    targetId?: string;
  }): Promise<void> {
    const [effect] = await this.db.client.select({ outboundMessageId: conversationTurnEffects.outboundMessageId })
      .from(conversationTurnEffects).where(and(
        eq(conversationTurnEffects.inboundMessageId, input.inboundMessageId),
        eq(conversationTurnEffects.tenantId, input.tenantId),
        eq(conversationTurnEffects.userId, input.userId),
        eq(conversationTurnEffects.conversationId, input.conversationId),
      )).limit(1);
    if (!effect) return;
    const queued = await this.db.client.update(conversationDispatchIntents)
      .set({ lastQueuedAt: new Date() }).where(and(
        eq(conversationDispatchIntents.inboundMessageId, input.inboundMessageId),
        eq(conversationDispatchIntents.kind, input.kind),
        eq(conversationDispatchIntents.targetId,
          input.kind === 'message_send' ? effect.outboundMessageId
            : input.kind === 'follow_up_execution' || input.kind === 'group_report'
              ? input.targetId ?? input.inboundMessageId
              : input.inboundMessageId),
        input.kind === 'profile_hydration' || input.kind === 'style_analysis'
          || input.kind === 'memory_extraction'
          ? isNull(conversationDispatchIntents.completedAt) : undefined,
      )).returning({ id: conversationDispatchIntents.id });
    if (queued.length !== 1) {
      if (input.kind === 'profile_hydration' || input.kind === 'style_analysis'
        || input.kind === 'memory_extraction') {
        const [completed] = await this.db.client.select({ id: conversationDispatchIntents.id })
          .from(conversationDispatchIntents).where(and(
            eq(conversationDispatchIntents.inboundMessageId, input.inboundMessageId),
            eq(conversationDispatchIntents.kind, input.kind),
            eq(conversationDispatchIntents.targetId, input.inboundMessageId),
            isNotNull(conversationDispatchIntents.completedAt),
          )).limit(1);
        if (completed) return;
      }
      throw new Error('conversation_dispatch_intent_missing');
    }
  }

  async claimCommittedMessageSendAttempt(input: {
    messageId: string; tenantId: string; userId: string; conversationId: string;
  }): Promise<'claimed' | 'already_started' | 'not_tracked'> {
    const [effect] = await this.db.client.select({ inboundMessageId: conversationTurnEffects.inboundMessageId })
      .from(conversationTurnEffects).where(and(
        eq(conversationTurnEffects.outboundMessageId, input.messageId),
        eq(conversationTurnEffects.tenantId, input.tenantId),
        eq(conversationTurnEffects.userId, input.userId),
        eq(conversationTurnEffects.conversationId, input.conversationId),
      )).limit(1);
    if (!effect) return 'not_tracked';
    const [existing] = await this.db.client.select({ outboundMessageId: conversationMessageSendAttempts.outboundMessageId })
      .from(conversationMessageSendAttempts)
      .where(eq(conversationMessageSendAttempts.outboundMessageId, input.messageId)).limit(1);
    if (existing) return 'already_started';
    try {
      const [claimed] = await this.db.client.insert(conversationMessageSendAttempts).values({
        inboundMessageId: effect.inboundMessageId,
        outboundMessageId: input.messageId,
      }).onConflictDoNothing().returning({ outboundMessageId: conversationMessageSendAttempts.outboundMessageId });
      return claimed ? 'claimed' : 'already_started';
    } catch (error) {
      const [raced] = await this.db.client.select({ outboundMessageId: conversationMessageSendAttempts.outboundMessageId })
        .from(conversationMessageSendAttempts)
        .where(eq(conversationMessageSendAttempts.outboundMessageId, input.messageId)).limit(1);
      if (raced) return 'already_started';
      throw error;
    }
  }

  async findRecoverableMessageSends(now: Date, afterIntentId?: string): Promise<Array<{
    intentId: string; inboundMessageId: string; outboundMessageId: string;
    tenantId: string; userId: string; conversationId: string;
    channelType: string; externalWorkspaceId: string; externalConversationId: string;
  }>> {
    const retryBefore = new Date(now.getTime() - 5 * 60_000);
    const rows = await this.db.client.execute(sql`select intent.id as intent_id,
        effect.inbound_message_id, effect.outbound_message_id,
        effect.tenant_id, effect.user_id, effect.conversation_id,
        owner.channel_type, admission.external_workspace_id, admission.external_conversation_id
      from ${conversationDispatchIntents} intent
      join ${conversationTurnEffects} effect on effect.inbound_message_id = intent.inbound_message_id
        and effect.outbound_message_id = intent.target_id
      join ${conversationJobAdmissions} admission on admission.message_id = effect.inbound_message_id
        and admission.tenant_id = effect.tenant_id and admission.user_id = effect.user_id
        and admission.conversation_id = effect.conversation_id
      join ${conversations} owner on owner.id = effect.conversation_id
        and owner.tenant_id = effect.tenant_id and owner.user_id = effect.user_id
        and owner.external_conversation_id = admission.external_conversation_id
      join ${messages} outbound on outbound.id = effect.outbound_message_id
        and outbound.tenant_id = effect.tenant_id and outbound.user_id = effect.user_id
        and outbound.conversation_id = effect.conversation_id
        and outbound.direction = 'outbound' and outbound.deleted_at is null
      left join ${conversationMessageSendAttempts} attempt
        on attempt.outbound_message_id = effect.outbound_message_id
      where intent.kind = 'message_send' and outbound.sent_at is null
        and attempt.outbound_message_id is null
        and intent.available_at <= ${now.toISOString()}::timestamptz
        and (intent.last_queued_at is null
          or intent.last_queued_at <= ${retryBefore.toISOString()}::timestamptz)
        and ${afterIntentId ? sql`intent.id > ${afterIntentId}::uuid` : sql`true`}
      order by intent.id limit 100`);
    return rows.map((row) => ({
      intentId: String(row['intent_id']),
      inboundMessageId: String(row['inbound_message_id']),
      outboundMessageId: String(row['outbound_message_id']),
      tenantId: String(row['tenant_id']), userId: String(row['user_id']),
      conversationId: String(row['conversation_id']), channelType: String(row['channel_type']),
      externalWorkspaceId: String(row['external_workspace_id']),
      externalConversationId: String(row['external_conversation_id']),
    }));
  }

  async findRecoverableFollowUpExecutions(now: Date, afterActionId?: string): Promise<Array<{
    actionId: string; tenantId: string; userId: string; dueAt: Date;
  }>> {
    const settledBefore = new Date(now.getTime() - 5 * 60_000);
    const horizon = new Date(now.getTime() + 5 * 60_000);
    const rows = await this.db.client.execute(sql`select action.id as action_id,
      action.tenant_id, action.user_id, action.due_at
      from ${scheduledActions} action
      join ${users} person on person.id = action.user_id
        and person.tenant_id = action.tenant_id
      where action.status = 'pending'
        and action.updated_at <= ${settledBefore.toISOString()}::timestamptz
        and action.due_at <= ${horizon.toISOString()}::timestamptz
        ${afterActionId ? sql`and action.id > ${afterActionId}::uuid` : sql``}
      order by action.id limit 100`);
    return rows.map((row) => ({
      actionId: String(row['action_id']), tenantId: String(row['tenant_id']),
      userId: String(row['user_id']), dueAt: new Date(String(row['due_at'])),
    }));
  }

  async countUnresolvedMessageSends(now: Date): Promise<number> {
    const retryBefore = new Date(now.getTime() - 5 * 60_000);
    const rows = await this.db.client.execute(sql`select count(*)::integer as count
      from ${conversationMessageSendAttempts} attempt
      join ${messages} outbound on outbound.id = attempt.outbound_message_id
      where outbound.sent_at is null and outbound.deleted_at is null
        and attempt.started_at <= ${retryBefore.toISOString()}::timestamptz`);
    return Number(rows[0]?.['count'] ?? 0);
  }

  async findRecoverableProfileHydrations(now: Date, afterIntentId?: string): Promise<Array<{
    intentId: string; inboundMessageId: string; tenantId: string; userId: string;
    conversationId: string; channelType: string; externalWorkspaceId: string; traceId: string;
  }>> {
    return this.findRecoverableSourceIntents('profile_hydration', now, afterIntentId);
  }

  async findRecoverableStyleAnalyses(now: Date, afterIntentId?: string): Promise<Array<{
    intentId: string; inboundMessageId: string; tenantId: string; userId: string;
    conversationId: string; channelType: string; externalWorkspaceId: string; traceId: string;
  }>> {
    return this.findRecoverableSourceIntents('style_analysis', now, afterIntentId);
  }

  async findRecoverableMemoryExtractions(now: Date, afterIntentId?: string): Promise<Array<{
    intentId: string; inboundMessageId: string; outboundMessageId: string;
    tenantId: string; userId: string; conversationId: string;
    channelType: string; externalWorkspaceId: string; externalConversationId: string; traceId: string;
  }>> {
    return this.findRecoverableSourceIntents('memory_extraction', now, afterIntentId);
  }

  async findRecoverableSurveyEvidence(now: Date, afterIntentId?: string): Promise<Array<{
    intentId: string; inboundMessageId: string; outboundMessageId: string;
    tenantId: string; userId: string; conversationId: string;
    channelType: string; externalWorkspaceId: string; externalConversationId: string; traceId: string;
  }>> {
    return this.findRecoverableSourceIntents('survey_evidence', now, afterIntentId);
  }

  async findRecoverableGroupReports(now: Date, afterIntentId?: string): Promise<Array<{
    intentId: string; sourceGroupStateId: string; reportingCohortId: string;
    tenantId: string; userId: string; teamId: string; questionGroup: string;
  }>> {
    const retryBefore = new Date(now.getTime() - 5 * 60_000);
    const rows = await this.db.client.execute(sql`select intent.id as intent_id,
        state.id as source_group_state_id, cohort.id as reporting_cohort_id,
        effect.tenant_id, effect.user_id, cohort.team_id, state.question_group
      from ${conversationDispatchIntents} intent
      join ${conversationTurnEffects} effect on effect.inbound_message_id = intent.inbound_message_id
      join ${surveyGroupStates} state on state.id = intent.target_id
        and state.tenant_id = effect.tenant_id and state.user_id = effect.user_id
        and state.confirmation_message_id = effect.inbound_message_id
        and state.status = 'confirmed'
      join ${surveyWindows} cycle_window on cycle_window.id = state.survey_window_id
        and cycle_window.tenant_id = effect.tenant_id and cycle_window.user_id = effect.user_id
      join ${surveyReportingCohorts} cohort on cohort.id = cycle_window.reporting_cohort_id
        and cohort.tenant_id = effect.tenant_id and cohort.team_id = cycle_window.reporting_team_id
      where intent.kind = 'group_report' and intent.completed_at is null
        and intent.last_queued_at <= ${retryBefore.toISOString()}::timestamptz
        and ${afterIntentId ? sql`intent.id > ${afterIntentId}::uuid` : sql`true`}
      order by intent.id limit 100`);
    return rows.map((row) => ({
      intentId: String(row['intent_id']), sourceGroupStateId: String(row['source_group_state_id']),
      reportingCohortId: String(row['reporting_cohort_id']),
      tenantId: String(row['tenant_id']), userId: String(row['user_id']),
      teamId: String(row['team_id']), questionGroup: String(row['question_group']),
    }));
  }

  async completeGroupReportIntent(input: {
    sourceGroupStateId: string; reportingCohortId: string;
    tenantId: string; teamId: string; questionGroup: string;
  }): Promise<void> {
    const rows = await this.db.client.execute(sql`update ${conversationDispatchIntents} intent
      set completed_at = coalesce(intent.completed_at, now())
      from ${conversationTurnEffects} effect, ${surveyGroupStates} state,
        ${surveyWindows} cycle_window, ${surveyReportingCohorts} cohort
      where intent.kind = 'group_report' and intent.target_id = ${input.sourceGroupStateId}::uuid
        and effect.inbound_message_id = intent.inbound_message_id
        and effect.tenant_id = ${input.tenantId}::uuid
        and state.id = intent.target_id and state.tenant_id = effect.tenant_id
        and state.user_id = effect.user_id
        and state.confirmation_message_id = effect.inbound_message_id
        and state.question_group = ${input.questionGroup}
        and cycle_window.id = state.survey_window_id and cycle_window.tenant_id = effect.tenant_id
        and cycle_window.user_id = effect.user_id
        and cohort.id = cycle_window.reporting_cohort_id
        and cohort.id = ${input.reportingCohortId}::uuid
        and cohort.tenant_id = effect.tenant_id
        and cohort.team_id = ${input.teamId}::uuid
        and cohort.team_id = cycle_window.reporting_team_id
      returning intent.id`);
    if (rows.length !== 1) throw new Error('group_report_intent_scope_mismatch');
  }

  private async findRecoverableSourceIntents(
    kind: 'profile_hydration' | 'style_analysis' | 'memory_extraction' | 'survey_evidence',
    now: Date,
    afterIntentId?: string,
  ): Promise<Array<{
    intentId: string; inboundMessageId: string; outboundMessageId: string;
    tenantId: string; userId: string; conversationId: string;
    channelType: string; externalWorkspaceId: string; externalConversationId: string; traceId: string;
  }>> {
    const retryBefore = new Date(now.getTime() - 5 * 60_000);
    const rows = await this.db.client.execute(sql`select intent.id as intent_id,
        intent.inbound_message_id, effect.outbound_message_id,
        effect.tenant_id, effect.user_id, effect.conversation_id,
        owner.channel_type, admission.external_workspace_id,
        admission.external_conversation_id, admission.trace_id
      from ${conversationDispatchIntents} intent
      join ${conversationTurnEffects} effect on effect.inbound_message_id = intent.inbound_message_id
      join ${conversationJobAdmissions} admission on admission.message_id = effect.inbound_message_id
        and admission.tenant_id = effect.tenant_id and admission.user_id = effect.user_id
        and admission.conversation_id = effect.conversation_id
      join ${conversations} owner on owner.id = effect.conversation_id
        and owner.tenant_id = effect.tenant_id and owner.user_id = effect.user_id
        and owner.external_conversation_id = admission.external_conversation_id
      join ${messages} inbound on inbound.id = effect.inbound_message_id
        and inbound.tenant_id = effect.tenant_id and inbound.user_id = effect.user_id
        and inbound.conversation_id = effect.conversation_id
        and inbound.direction = 'inbound' and inbound.deleted_at is null
      where intent.kind = ${kind} and intent.target_id = effect.inbound_message_id
        and intent.completed_at is null
        and intent.last_queued_at <= ${retryBefore.toISOString()}::timestamptz
        and ${afterIntentId ? sql`intent.id > ${afterIntentId}::uuid` : sql`true`}
      order by intent.id limit 100`);
    return rows.map((row) => ({
      intentId: String(row['intent_id']), inboundMessageId: String(row['inbound_message_id']),
      outboundMessageId: String(row['outbound_message_id']),
      tenantId: String(row['tenant_id']), userId: String(row['user_id']),
      conversationId: String(row['conversation_id']), channelType: String(row['channel_type']),
      externalWorkspaceId: String(row['external_workspace_id']),
      externalConversationId: String(row['external_conversation_id']), traceId: String(row['trace_id']),
    }));
  }

  async findCommittedAdmissionsWithUnqueuedDispatches(now: Date, afterMessageId?: string): Promise<Array<{
    messageId: string; tenantId: string; userId: string; conversationId: string;
  }>> {
    const readyBefore = new Date(now.getTime() - 60_000);
    const rows = await this.db.client.execute(sql`select distinct on (admission.message_id)
        admission.message_id, admission.tenant_id, admission.user_id, admission.conversation_id
      from ${conversationDispatchIntents} intent
      join ${conversationTurnEffects} effect on effect.inbound_message_id = intent.inbound_message_id
      join ${conversationJobAdmissions} admission on admission.message_id = effect.inbound_message_id
        and admission.tenant_id = effect.tenant_id and admission.user_id = effect.user_id
        and admission.conversation_id = effect.conversation_id
      join ${conversations} owner on owner.id = admission.conversation_id
        and owner.tenant_id = admission.tenant_id and owner.user_id = admission.user_id
        and owner.external_conversation_id = admission.external_conversation_id
      join ${messages} inbound on inbound.id = admission.message_id
        and inbound.tenant_id = admission.tenant_id and inbound.user_id = admission.user_id
        and inbound.conversation_id = admission.conversation_id
        and inbound.direction = 'inbound' and inbound.deleted_at is null
      where intent.last_queued_at is null
        and intent.available_at <= ${readyBefore.toISOString()}::timestamptz
        and ${afterMessageId ? sql`admission.message_id > ${afterMessageId}::uuid` : sql`true`}
      order by admission.message_id
      limit 100`);
    return rows.map((row) => ({
      messageId: String(row['message_id']), tenantId: String(row['tenant_id']),
      userId: String(row['user_id']), conversationId: String(row['conversation_id']),
    }));
  }

  async findCommittedAdmissionForRecovery(input: {
    messageId: string; tenantId: string; userId: string; conversationId: string;
  }): Promise<{
    messageId: string; tenantId: string; userId: string; conversationId: string;
    externalWorkspaceId: string; externalConversationId: string;
    eventId: string; requestId: string; traceId: string;
  } | null> {
    const rows = await this.db.client.execute(sql`select admission.message_id,
        admission.tenant_id, admission.user_id, admission.conversation_id,
        admission.external_workspace_id, admission.external_conversation_id,
        admission.event_id, admission.request_id, admission.trace_id
      from ${conversationJobAdmissions} admission
      join ${conversationTurnEffects} effect on effect.inbound_message_id = admission.message_id
        and effect.tenant_id = admission.tenant_id and effect.user_id = admission.user_id
        and effect.conversation_id = admission.conversation_id
      join ${messages} inbound on inbound.id = admission.message_id
        and inbound.tenant_id = admission.tenant_id and inbound.user_id = admission.user_id
        and inbound.conversation_id = admission.conversation_id
        and inbound.direction = 'inbound' and inbound.deleted_at is null
      join ${conversations} owner on owner.id = admission.conversation_id
        and owner.tenant_id = admission.tenant_id and owner.user_id = admission.user_id
        and owner.external_conversation_id = admission.external_conversation_id
      where admission.message_id = ${input.messageId}::uuid
        and admission.tenant_id = ${input.tenantId}::uuid
        and admission.user_id = ${input.userId}::uuid
        and admission.conversation_id = ${input.conversationId}::uuid
      limit 1`);
    const row = rows[0];
    return row ? {
      messageId: String(row['message_id']), tenantId: String(row['tenant_id']),
      userId: String(row['user_id']), conversationId: String(row['conversation_id']),
      externalWorkspaceId: String(row['external_workspace_id']),
      externalConversationId: String(row['external_conversation_id']),
      eventId: String(row['event_id']), requestId: String(row['request_id']),
      traceId: String(row['trace_id']),
    } : null;
  }

  async findMessageById(id: string, tenantId: string, conversationId: string): Promise<MessageRecord | null> {
    const [row] = await this.db.client.select({ message: messages }).from(messages)
      .innerJoin(conversations, and(
        eq(conversations.id, messages.conversationId),
        eq(conversations.tenantId, messages.tenantId),
        eq(conversations.userId, messages.userId),
      )).where(and(
      eq(messages.id, id), eq(messages.tenantId, tenantId), eq(messages.conversationId, conversationId),
      isNull(messages.deletedAt),
    )).limit(1);
    const message = row?.message;
    return message ? {
      id: message.id, tenantId: message.tenantId, conversationId: message.conversationId,
      userId: message.userId, direction: message.direction as 'inbound' | 'outbound',
      text: message.text, occurredAt: message.occurredAt, createdAt: message.occurredAt,
      externalMessageId: message.externalMessageId ?? undefined,
      externalThreadId: message.externalThreadId ?? undefined,
      sentAt: message.sentAt ?? undefined,
      metadata: message.metadata as MessageRecord['metadata'],
    } : null;
  }

  async findOutboundMessageForDelivery(
    messageId: string,
    tenantId: string,
    conversationId: string,
  ): Promise<{
    userId: string;
    text: string;
    sentAt: Date | null;
    externalMessageId: string | null;
    onboardingDeliveryId: string | null;
    channelType: string;
    externalConversationId: string;
  } | null> {
    const [row] = await this.db.client
      .select({
        userId: messages.userId,
        text: messages.text,
        sentAt: messages.sentAt,
        externalMessageId: messages.externalMessageId,
        onboardingDeliveryId: sql<string | null>`${messages.metadata}->>'onboardingDeliveryId'`,
        channelType: conversations.channelType,
        externalConversationId: conversations.externalConversationId,
      })
      .from(messages)
      .innerJoin(
        conversations,
        and(
          eq(conversations.id, messages.conversationId),
          eq(conversations.tenantId, messages.tenantId),
          eq(conversations.userId, messages.userId),
        ),
      )
      .where(and(
        eq(messages.id, messageId),
        eq(messages.tenantId, tenantId),
        eq(messages.conversationId, conversationId),
        eq(messages.direction, 'outbound'),
        isNull(messages.deletedAt),
      ))
      .limit(1);
    return row ?? null;
  }

  async findLatestDeliveredReportingDisclosure(
    tenantId: string,
    userId: string,
    version: string,
    before: Date,
  ): Promise<ReportingDisclosureReceiptRecord | null> {
    const [row] = await this.db.client
      .select({
        shownAt: messages.sentAt,
      })
      .from(messages)
      .innerJoin(conversations, and(
        eq(conversations.id, messages.conversationId),
        eq(conversations.tenantId, messages.tenantId),
        eq(conversations.userId, messages.userId),
      ))
      .where(
        and(
          eq(messages.tenantId, tenantId),
          eq(messages.userId, userId),
        eq(messages.direction, 'outbound'),
        isNotNull(messages.sentAt),
        isNull(messages.deletedAt),
        sql`${messages.metadata}->>'reportingDisclosureVersion' = ${version}`,
        lt(messages.sentAt, before),
        ),
      )
      .orderBy(desc(messages.sentAt))
      .limit(1);

    if (!row?.shownAt) return null;

    return {
      version,
      shownAt: row.shownAt,
    };
  }

  async updateMessageDelivery(
    messageId: string,
    params: {
      tenantId: string;
      conversationId: string;
      externalMessageId: string;
      externalThreadId?: string;
      sentAt: Date;
    },
  ): Promise<Date> {
    const rows = await this.db.client
      .update(messages)
      .set({
        externalMessageId: params.externalMessageId,
        externalThreadId: params.externalThreadId ?? null,
        sentAt: params.sentAt,
      })
      .where(
        and(
          eq(messages.id, messageId),
          eq(messages.tenantId, params.tenantId),
          eq(messages.conversationId, params.conversationId),
          eq(messages.direction, 'outbound'),
          isNull(messages.sentAt),
          isNull(messages.deletedAt),
        ),
      )
      .returning({ id: messages.id, sentAt: messages.sentAt });
    if (rows[0]?.sentAt) return rows[0].sentAt;

    const [existing] = await this.db.client
      .select({ sentAt: messages.sentAt })
      .from(messages)
      .where(
        and(
          eq(messages.id, messageId),
          eq(messages.tenantId, params.tenantId),
          eq(messages.conversationId, params.conversationId),
          eq(messages.direction, 'outbound'),
          isNotNull(messages.sentAt),
          isNull(messages.deletedAt),
        ),
      )
      .limit(1);
    if (existing?.sentAt) return existing.sentAt;

    throw new Error(`Delivery update scope mismatch: ${messageId}`);
  }
}

type InboundOrderRecord = {
  id: string;
  occurredAt: Date;
  receivedAt?: Date | null;
  externalMessageId: string | null | undefined;
};

export function isNewerInboundWithinWindow(
  anchor: InboundOrderRecord,
  candidate: InboundOrderRecord,
  windowMs: number,
): boolean {
  if (
    anchor.receivedAt
    && candidate.receivedAt
    && anchor.receivedAt.getTime() - candidate.receivedAt.getTime() >= windowMs
  ) return false;

  const anchorSlackMicros = parseSlackTimestampMicros(anchor.externalMessageId);
  const candidateSlackMicros = parseSlackTimestampMicros(candidate.externalMessageId);
  if (anchorSlackMicros !== undefined && candidateSlackMicros !== undefined) {
    const elapsedMicros = candidateSlackMicros - anchorSlackMicros;
    if (elapsedMicros < 0n || elapsedMicros >= BigInt(windowMs) * 1_000n) return false;
    if (elapsedMicros > 0n) return true;
  } else {
    const elapsedMs = candidate.occurredAt.getTime() - anchor.occurredAt.getTime();
    if (elapsedMs < 0 || elapsedMs >= windowMs) return false;
    if (elapsedMs > 0) return true;
  }

  const anchorKey = anchor.externalMessageId ?? anchor.id;
  const candidateKey = candidate.externalMessageId ?? candidate.id;
  if (candidateKey !== anchorKey) return candidateKey > anchorKey;
  return candidate.id > anchor.id;
}

function parseSlackTimestampMicros(value: string | null | undefined): bigint | undefined {
  const match = /^(\d+)\.(\d{1,6})$/.exec(value ?? '');
  if (!match) return undefined;
  return BigInt(match[1]!) * 1_000_000n + BigInt(match[2]!.padEnd(6, '0'));
}

export function toConversationActiveTopic(
  value: unknown,
): NonNullable<ConversationRecord['activeTopic']> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;

  const topic = value as Record<string, unknown>;
  const summary = typeof topic['summary'] === 'string'
    ? topic['summary'].trim().replace(/\s+/gu, ' ')
    : '';
  const startedAt = typeof topic['startedAt'] === 'string' ? topic['startedAt'] : '';
  const startedAtDate = new Date(startedAt);
  if (
    !summary ||
    [...summary].length > 500 ||
    (topic['status'] !== 'active' && topic['status'] !== 'parked') ||
    !startedAt ||
    Number.isNaN(startedAtDate.getTime()) ||
    startedAtDate.toISOString() !== startedAt
  ) {
    return undefined;
  }

  return {
    summary,
    status: topic['status'],
    startedAt,
  };
}
