import { Injectable } from '@nestjs/common';
import { eq, and, desc } from 'drizzle-orm';
import { conversations, messages, users } from '@entalent/database';
import type { ConversationRepositoryPort, ConversationRecord, MessageRecord, SaveMessageParams } from '@entalent/application';
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
        userTimezone: users.timezone,
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
      userTimezone: row.userTimezone ?? undefined,
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

  async updateMessageDelivery(
    messageId: string,
    params: { externalMessageId: string; externalThreadId?: string; sentAt: Date },
  ): Promise<void> {
    await this.db.client
      .update(messages)
      .set({
        externalMessageId: params.externalMessageId,
        externalThreadId: params.externalThreadId,
        sentAt: params.sentAt,
      })
      .where(eq(messages.id, messageId));
  }
}
