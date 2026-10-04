import { readOnboardingState } from '@entalent/application';
import { Injectable } from '@nestjs/common';
import { eq, and, desc, gte, isNotNull, isNull, lt, lte, ne, sql } from 'drizzle-orm';
import { channelAccounts, conversations, messages, orgOnboardingDeliveries, people, users } from '@entalent/database';
import { isRuntimeEligibleUser } from '@entalent/application';
import type {
  ConversationRepositoryPort,
  ConversationRecord,
  MessageRecord,
  ReportingDisclosureReceiptRecord,
  SaveMessageParams,
} from '@entalent/application';
import { DatabaseService } from '../../database/database.service';

@Injectable()
export class ConversationRepository implements ConversationRepositoryPort {
  constructor(private readonly db: DatabaseService) {}

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

  async isOnboardingReminderAllowed(tenantId: string, userId: string): Promise<boolean> {
    const [row] = await this.db.client.select({ preferences: users.communicationPreferences }).from(users)
      .where(and(eq(users.id, userId), eq(users.tenantId, tenantId))).limit(1);
    const state = readOnboardingState(row?.preferences);
    return !!state && state.personalParticipation === 'undecided' && !state.managementCompleted;
  }

  async isPersonalParticipationActive(tenantId: string, userId: string): Promise<boolean> {
    const [row] = await this.db.client.select({ preferences: users.communicationPreferences }).from(users)
      .where(and(eq(users.id, userId), eq(users.tenantId, tenantId))).limit(1);
    const state = readOnboardingState(row?.preferences);
    return !!row && (!state || state.personalParticipation === 'active');
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
        communicationPreferences: users.communicationPreferences,
        pulseParticipant: people.pulseParticipant,
        userTimezone: users.timezone,
        userTimezoneUpdatedAt: users.timezoneUpdatedAt,
      })
      .from(conversations)
      .leftJoin(users, eq(conversations.userId, users.id))
      .leftJoin(people, and(eq(people.id, users.id), eq(people.tenantId, users.tenantId)))
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
      personalParticipation: readOnboardingState(row.communicationPreferences)?.personalParticipation ?? (row.pulseParticipant === false ? 'declined' : undefined),
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
      .select()
      .from(messages)
      .where(and(
        eq(messages.conversationId, conversationId),
        isNull(messages.deletedAt),
      ))
      .orderBy(desc(messages.occurredAt), desc(messageOrderKey), desc(messages.id))
      .limit(limit);

    return rows
      .reverse()
      .map((m) => ({
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
      .where(and(scope, eq(messages.id, params.messageId)))
      .limit(1);
    if (!anchor) return true;

    const windowEnd = new Date(anchor.occurredAt.getTime() + params.windowMs);
    const candidates = await this.db.client
      .select(selection)
      .from(messages)
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
    if (!msg || msg.userId !== params.userId || msg.direction !== params.direction ||
      msg.messageType !== (params.messageType ?? 'text') ||
      (params.id && (msg.metadata as Record<string, unknown>)['onboardingDeliveryId'] !== params.id)) {
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

  async findMessageById(id: string, tenantId: string, conversationId: string): Promise<MessageRecord | null> {
    const [message] = await this.db.client.select().from(messages).where(and(
      eq(messages.id, id), eq(messages.tenantId, tenantId), eq(messages.conversationId, conversationId),
      isNull(messages.deletedAt),
    )).limit(1);
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
    metadata?: Record<string, unknown>;
    channelType: string;
    externalConversationId: string;
  } | null> {
    const [row] = await this.db.client
      .select({
        userId: messages.userId,
        text: messages.text,
        metadata: messages.metadata,
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
    return row ? { ...row, metadata: row.metadata as Record<string, unknown> } : null;
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
