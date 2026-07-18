import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type {
  ProactiveSchedulerRepositoryPort,
  FindCheckInCandidatesParams,
  CheckInCandidate,
} from '@entalent/application';
import { DatabaseService } from '../database/database.service';

interface CandidateRow {
  user_id: string;
  tenant_id: string;
  timezone: string;
  quiet_hours: { enabled: boolean; startHour?: number; endHour?: number } | null;
  preferred_name: string | null;
  conversation_id: string;
  channel_type: string;
  external_conversation_id: string;
  external_workspace_id: string;
}

/**
 * Finds users due for a proactive check-in. All gating that can be expressed in
 * SQL happens here — silence since last message, cadence since last proactive
 * contact, and absence of an active high/critical risk signal. The per-user
 * quiet-hours guard (which needs timezone math) is applied by the use case.
 */
@Injectable()
export class ProactiveSchedulerRepository implements ProactiveSchedulerRepositoryPort {
  constructor(private readonly db: DatabaseService) {}

  async findCheckInCandidates(params: FindCheckInCandidatesParams): Promise<CheckInCandidate[]> {
    const tenantFilter = params.tenantId
      ? sql`AND u.tenant_id = ${params.tenantId}`
      : sql``;

    const rows = (await this.db.client.execute(sql`
      SELECT
        u.id AS user_id,
        u.tenant_id AS tenant_id,
        COALESCE(u.timezone, 'UTC') AS timezone,
        u.quiet_hours AS quiet_hours,
        u.preferred_name AS preferred_name,
        c.id AS conversation_id,
        c.channel_type AS channel_type,
        c.external_conversation_id AS external_conversation_id,
        COALESCE(wc.external_workspace_id, 'dev-workspace') AS external_workspace_id
      FROM users u
      JOIN LATERAL (
        SELECT id, channel_type, external_conversation_id
        FROM conversations
        WHERE user_id = u.id AND status = 'active'
        ORDER BY created_at DESC
        LIMIT 1
      ) c ON true
      LEFT JOIN workspace_connections wc
        ON wc.tenant_id = u.tenant_id AND wc.channel_type = c.channel_type AND wc.status = 'active'
      WHERE u.status = 'active'
        AND u.proactive_messaging_enabled = true
        ${tenantFilter}
        AND NOT EXISTS (
          SELECT 1 FROM messages m
          WHERE m.user_id = u.id AND m.direction = 'inbound' AND m.text <> '__init__'
            AND m.occurred_at > now() - make_interval(days => ${params.minSilenceDays})
        )
        AND NOT EXISTS (
          SELECT 1 FROM messages m
          WHERE m.user_id = u.id AND m.direction = 'outbound'
            AND m.message_type IN ('proactive_check_in', 'proactive_follow_up', 'reminder')
            AND m.occurred_at > now() - make_interval(days => ${params.minCheckInGapDays})
        )
        AND NOT EXISTS (
          SELECT 1 FROM risk_signals r
          WHERE r.user_id = u.id AND r.status = 'active' AND r.severity IN ('high', 'critical')
        )
        AND (c.channel_type = 'dev' OR wc.id IS NOT NULL)
      LIMIT ${params.limit}
    `)) as unknown as CandidateRow[];

    return rows.map((r) => ({
      userId: r.user_id,
      tenantId: r.tenant_id,
      conversationId: r.conversation_id,
      channelType: r.channel_type,
      externalConversationId: r.external_conversation_id,
      externalWorkspaceId: r.external_workspace_id,
      timezone: r.timezone,
      quietHours: r.quiet_hours ?? { enabled: false },
      preferredName: r.preferred_name ?? undefined,
    }));
  }
}
