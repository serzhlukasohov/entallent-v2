import { Injectable } from '@nestjs/common';
import { eq, and, desc, gte, isNotNull, isNull, lt, lte, ne, sql } from 'drizzle-orm';
import { conversations, messages, users } from '@entalent/database';
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
      .select()
      .from(messages)
      .where(eq(messages.conversationId, conversationId))
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
    const [msg] = await this.db.client
      .insert(messages)
      .values({
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
      })
      .returning();

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
    };
  }

  async findOutboundMessageForDelivery(
    messageId: string,
    tenantId: string,
    conversationId: string,
  ): Promise<{
    text: string;
    sentAt: Date | null;
    channelType: string;
    externalConversationId: string;
  } | null> {
    const [row] = await this.db.client
      .select({
        text: messages.text,
        sentAt: messages.sentAt,
        channelType: conversations.channelType,
        externalConversationId: conversations.externalConversationId,
      })
      .from(messages)
      .innerJoin(
        conversations,
        and(
          eq(conversations.id, messages.conversationId),
          eq(conversations.tenantId, messages.tenantId),
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
