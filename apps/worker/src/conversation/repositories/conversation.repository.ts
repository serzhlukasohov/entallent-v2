import { Injectable } from '@nestjs/common';
import { eq, and, desc, isNotNull, isNull, lt, sql } from 'drizzle-orm';
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
      userDisplayName: row.userDisplayName ?? undefined,
      userLocale: row.userLocale ?? undefined,
      userTimezone: row.userTimezone ?? undefined,
      userTimezoneUpdatedAt: row.userTimezoneUpdatedAt ?? undefined,
    };
  }

  async findRecentMessages(conversationId: string, limit: number): Promise<MessageRecord[]> {
    const rows = await this.db.client
      .select()
      .from(messages)
      .where(eq(messages.conversationId, conversationId))
      .orderBy(desc(messages.occurredAt))
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
        externalMessageId: sql`coalesce(${messages.externalMessageId}, ${params.externalMessageId})`,
        externalThreadId: sql`coalesce(${messages.externalThreadId}, ${params.externalThreadId ?? null})`,
        sentAt: sql`coalesce(${messages.sentAt}, ${params.sentAt})`,
      })
      .where(
        and(
          eq(messages.id, messageId),
          eq(messages.tenantId, params.tenantId),
          eq(messages.conversationId, params.conversationId),
        ),
      )
      .returning({ id: messages.id, sentAt: messages.sentAt });
    if (rows.length !== 1) {
      throw new Error(`Delivery update scope mismatch: ${messageId}`);
    }
    if (!rows[0]?.sentAt) throw new Error(`Delivery timestamp missing: ${messageId}`);
    return rows[0].sentAt;
  }
}
