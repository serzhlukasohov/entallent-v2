import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { eq, and } from 'drizzle-orm';
import type { Env } from '@entalent/config';
import { decryptField } from '@entalent/crypto-utils';
import {
  users,
  people,
  channelAccounts,
  conversations,
  messages,
  conversationJobAdmissions,
  workspaceConnections,
  type DbClient,
} from '@entalent/database';
import {
  resolveExternalProfileFacts,
  isRuntimeEligibleUser,
  type IngestionRepositoryPort,
  type WorkspaceIdentity,
  type IngestMessageResult,
  type IngestMessageParams,
} from '@entalent/application';
import { DatabaseService } from '../database/database.service';

type Transaction = Parameters<Parameters<DbClient['db']['transaction']>[0]>[0];

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
  }): Promise<{ userId: string; runtimeEligible: boolean }> {
    const profileFacts = resolveExternalProfileFacts({
      externalUserId: params.externalUserId,
      displayName: params.displayName,
    });
    try {
      return await this.db.client.transaction(async (tx) => {
        const existing = await this.findAccount(tx, params);
        if (existing) return existing;

        const [newUser] = await tx.insert(users)
          .values({ tenantId: params.tenantId, preferredName: profileFacts.preferredName })
          .returning({ id: users.id });
        if (!newUser) throw new Error('user insert returned no row');
        await tx.insert(channelAccounts).values({
          userId: newUser.id,
          tenantId: params.tenantId,
          channelType: params.channelType,
          externalWorkspaceId: params.externalWorkspaceId,
          externalUserId: params.externalUserId,
          displayName: profileFacts.displayName,
        });
        return { userId: newUser.id, runtimeEligible: true };
      });
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505') {
        const winner = await this.db.client.transaction((tx) => this.findAccount(tx, params));
        if (winner) return winner;
      }
      throw error;
    }
  }

  private async findAccount(
    tx: Transaction,
    params: { tenantId: string; channelType: string; externalWorkspaceId: string; externalUserId: string },
  ): Promise<{ userId: string; runtimeEligible: boolean } | null> {
    const [account] = await tx.select({
      userId: channelAccounts.userId,
      accountTenantId: channelAccounts.tenantId,
      userTenantId: users.tenantId,
      userStatus: users.status,
      linkStatus: channelAccounts.linkStatus,
      deletedAt: users.deletedAt,
      personLifecycle: people.lifecycleStatus,
      pulseParticipant: people.pulseParticipant,
    }).from(channelAccounts)
      .innerJoin(users, eq(users.id, channelAccounts.userId))
      .leftJoin(people, and(eq(people.id, users.id), eq(people.tenantId, users.tenantId)))
      .where(and(
        eq(channelAccounts.channelType, params.channelType),
        eq(channelAccounts.externalWorkspaceId, params.externalWorkspaceId),
        eq(channelAccounts.externalUserId, params.externalUserId),
      )).limit(1);
    if (!account) return null;
    if (account.accountTenantId !== params.tenantId || account.userTenantId !== params.tenantId) {
      throw new Error('channel_account_tenant_mismatch');
    }
    return {
      userId: account.userId,
      runtimeEligible: account.linkStatus === 'linked' && isRuntimeEligibleUser(account),
    };
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
        setWhere: and(
          eq(conversations.tenantId, params.tenantId),
          eq(conversations.userId, params.userId),
        ),
      })
      .returning({ id: conversations.id, tenantId: conversations.tenantId, userId: conversations.userId });

    if (!result || result.tenantId !== params.tenantId || result.userId !== params.userId) {
      throw new Error('conversation_owner_mismatch');
    }
    return { conversationId: result.id };
  }

  async saveInboundMessage(params: IngestMessageParams, admission?: {
    externalWorkspaceId: string;
    externalConversationId: string;
    eventId: string;
    requestId: string;
  }): Promise<IngestMessageResult> {
    return this.db.client.transaction(async (tx) => {
      const [msg] = await tx.insert(messages).values({
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
      }).returning({ id: messages.id });
      if (!msg) throw new Error('inbound_message_insert_failed');
      if (admission) {
        await tx.insert(conversationJobAdmissions).values({
          messageId: msg.id,
          tenantId: params.tenantId,
          userId: params.userId,
          conversationId: params.conversationId,
          externalWorkspaceId: admission.externalWorkspaceId,
          externalConversationId: admission.externalConversationId,
          eventId: admission.eventId,
          requestId: admission.requestId,
          traceId: params.traceId,
        });
      }
      return { messageId: msg.id };
    });
  }

  async markConversationJobQueued(input: { messageId: string; tenantId: string; userId: string }): Promise<void> {
    const [admission] = await this.db.client.update(conversationJobAdmissions)
      .set({ queuedAt: new Date() })
      .where(and(
        eq(conversationJobAdmissions.messageId, input.messageId),
        eq(conversationJobAdmissions.tenantId, input.tenantId),
        eq(conversationJobAdmissions.userId, input.userId),
      )).returning({ messageId: conversationJobAdmissions.messageId });
    if (!admission) throw new Error('conversation_job_admission_missing');
  }
}
