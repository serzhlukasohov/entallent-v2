import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { eq, and, desc, inArray } from 'drizzle-orm';
import { users, conversations, messages, workspaceConnections, riskSignals } from '@entalent/database';
import { decryptField } from '@entalent/crypto-utils';
import type { Env } from '@entalent/config';
import type {
  FollowUpContextPort,
  FollowUpContextData,
  ConversationRecord,
  WorkspaceConnectionRecord,
} from '@entalent/application';
import { DatabaseService } from '../../database/database.service';

const H24 = 24 * 60 * 60 * 1000;
const D7 = 7 * 24 * 60 * 60 * 1000;

@Injectable()
export class FollowUpContextRepository implements FollowUpContextPort {
  constructor(
    private readonly db: DatabaseService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async load(params: {
    userId: string;
    tenantId: string;
    conversationId?: string;
    channelType?: string;
  }): Promise<FollowUpContextData> {
    const [userRows, convRows, recentMsgs, riskRows] = await Promise.all([
      this.db.client
        .select()
        .from(users)
        .where(and(eq(users.id, params.userId), eq(users.tenantId, params.tenantId)))
        .limit(1),

      params.conversationId
        ? this.db.client
            .select()
            .from(conversations)
            .where(eq(conversations.id, params.conversationId))
            .limit(1)
        : Promise.resolve([]),

      this.db.client
        .select()
        .from(messages)
        .where(and(eq(messages.userId, params.userId), eq(messages.tenantId, params.tenantId)))
        .orderBy(desc(messages.occurredAt))
        .limit(100),

      this.db.client
        .select({ severity: riskSignals.severity })
        .from(riskSignals)
        .where(
          and(
            eq(riskSignals.userId, params.userId),
            eq(riskSignals.tenantId, params.tenantId),
            eq(riskSignals.status, 'active'),
            inArray(riskSignals.severity, ['high', 'critical']),
          ),
        )
        .limit(1),
    ]);

    const userRow = userRows[0];
    const convRow = (convRows as typeof conversations.$inferSelect[])[0];

    const now = Date.now();
    let lastInboundAt: Date | null = null;
    let proactiveCount24h = 0;
    let proactiveCount7d = 0;

    for (const msg of recentMsgs) {
      if (msg.direction === 'inbound' && !lastInboundAt) {
        lastInboundAt = msg.occurredAt;
      }
      if (msg.direction === 'outbound' && msg.messageType === 'proactive_follow_up') {
        const ts = msg.occurredAt.getTime();
        if (now - ts < H24) proactiveCount24h++;
        if (now - ts < D7) proactiveCount7d++;
      }
    }

    // Load workspace connection by tenant + channelType
    let wsConn: WorkspaceConnectionRecord | null = null;
    if (params.channelType) {
      wsConn = await this.findWorkspaceByTenant(params.tenantId, params.channelType);
    }

    const quietHours = (userRow?.quietHours as {
      enabled: boolean;
      startHour?: number;
      endHour?: number;
    } | null) ?? { enabled: false };

    const conversation: ConversationRecord | null = convRow
      ? {
          id: convRow.id,
          tenantId: convRow.tenantId,
          userId: convRow.userId,
          channelType: convRow.channelType,
          externalConversationId: convRow.externalConversationId,
          status: convRow.status,
        }
      : null;

    return {
      user: {
        proactiveMessagingEnabled: userRow?.proactiveMessagingEnabled ?? false,
        timezone: userRow?.timezone ?? 'UTC',
        quietHours,
        preferredName: userRow?.preferredName ?? undefined,
      },
      conversation,
      workspaceConnection: wsConn,
      lastInboundAt,
      recentProactiveCount24h: proactiveCount24h,
      recentProactiveCount7d: proactiveCount7d,
      hasActiveHighRisk: riskRows.length > 0,
    };
  }

  private async findWorkspaceByTenant(
    tenantId: string,
    channelType: string,
  ): Promise<WorkspaceConnectionRecord | null> {
    const [conn] = await this.db.client
      .select()
      .from(workspaceConnections)
      .where(
        and(
          eq(workspaceConnections.tenantId, tenantId),
          eq(workspaceConnections.channelType, channelType),
          eq(workspaceConnections.status, 'active'),
        ),
      )
      .limit(1);

    if (!conn) return null;

    const encKey = this.config.get('FIELD_ENCRYPTION_KEY', { infer: true });
    const creds = JSON.parse(decryptField(conn.encryptedCredentials, encKey)) as {
      botToken: string;
      signingSecret: string;
    };

    return {
      id: conn.id,
      tenantId: conn.tenantId,
      channelType: conn.channelType,
      externalWorkspaceId: conn.externalWorkspaceId,
      botToken: creds.botToken,
      signingSecret: creds.signingSecret,
    };
  }
}
