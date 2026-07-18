import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { eq, and } from 'drizzle-orm';
import type { Env } from '@entalent/config';
import { decryptField } from '@entalent/crypto-utils';
import {
  users,
  channelAccounts,
  conversations,
  messages,
  workspaceConnections,
} from '@entalent/database';
import type { IngestionRepositoryPort, WorkspaceIdentity, IngestMessageResult, IngestMessageParams } from '@entalent/application';
import { DatabaseService } from '../database/database.service';

@Injectable()
export class IngestionService implements IngestionRepositoryPort {
  constructor(
    private readonly db: DatabaseService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async findWorkspaceIdentity(
    channelType: string,
    externalWorkspaceId: string,
  ): Promise<WorkspaceIdentity | null> {
    const [conn] = await this.db.client
      .select()
      .from(workspaceConnections)
      .where(
        and(
          eq(workspaceConnections.channelType, channelType),
          eq(workspaceConnections.externalWorkspaceId, externalWorkspaceId),
          eq(workspaceConnections.status, 'active'),
        ),
      )
      .limit(1);

    if (!conn) return null;

    const encKey = this.config.get('FIELD_ENCRYPTION_KEY', { infer: true });
    const creds = JSON.parse(decryptField(conn.encryptedCredentials, encKey)) as {
      signingSecret: string;
    };

    return { tenantId: conn.tenantId, signingSecret: creds.signingSecret };
  }

  async findOrCreateUser(params: {
    tenantId: string;
    channelType: string;
    externalWorkspaceId: string;
    externalUserId: string;
    displayName?: string;
  }): Promise<{ userId: string }> {
    const [existing] = await this.db.client
      .select({ userId: channelAccounts.userId })
      .from(channelAccounts)
      .where(
        and(
          eq(channelAccounts.channelType, params.channelType),
          eq(channelAccounts.externalWorkspaceId, params.externalWorkspaceId),
          eq(channelAccounts.externalUserId, params.externalUserId),
        ),
      )
      .limit(1);

    if (existing) return { userId: existing.userId };

    const [newUser] = await this.db.client
      .insert(users)
      .values({ tenantId: params.tenantId, preferredName: params.displayName })
      .returning({ id: users.id });

    await this.db.client.insert(channelAccounts).values({
      userId: newUser.id,
      tenantId: params.tenantId,
      channelType: params.channelType,
      externalWorkspaceId: params.externalWorkspaceId,
      externalUserId: params.externalUserId,
      displayName: params.displayName,
    });

    return { userId: newUser.id };
  }

  async findOrCreateConversation(params: {
    tenantId: string;
    userId: string;
    channelType: string;
    externalConversationId: string;
  }): Promise<{ conversationId: string }> {
    const [result] = await this.db.client
      .insert(conversations)
      .values({
        tenantId: params.tenantId,
        userId: params.userId,
        channelType: params.channelType,
        externalConversationId: params.externalConversationId,
        status: 'active',
      })
      .onConflictDoUpdate({
        target: [
          conversations.tenantId,
          conversations.channelType,
          conversations.externalConversationId,
        ],
        set: { updatedAt: new Date() },
      })
      .returning({ id: conversations.id });

    return { conversationId: result.id };
  }

  async saveInboundMessage(params: IngestMessageParams): Promise<IngestMessageResult> {
    const [msg] = await this.db.client
      .insert(messages)
      .values({
        conversationId: params.conversationId,
        tenantId: params.tenantId,
        userId: params.userId,
        direction: 'inbound',
        senderType: 'user',
        text: params.text,
        externalMessageId: params.externalMessageId,
        externalThreadId: params.externalThreadId,
        occurredAt: params.occurredAt,
        receivedAt: new Date(),
        traceId: params.traceId,
      })
      .returning({ id: messages.id });

    return { messageId: msg.id };
  }
}
