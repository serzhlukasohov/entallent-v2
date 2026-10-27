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
  last_inbound_at: Date | string | null;
  last_proactive_contact_at: Date | string | null;
  recent_proactive_count: number | string;
  has_unanswered_proactive: boolean;
  in_qa_cadence_cohort: boolean;
}

function toDateOrNull(value: Date | string | null): Date | null {
  if (value === null) return null;
  const date = value instanceof Date ? value : new Date(value);
  // An Invalid Date would make every cadence comparison false and fail open.
  if (Number.isNaN(date.getTime())) throw new Error(`Unparseable cadence timestamp: ${String(value)}`);
  return date;
}

/**
 * Finds users due for a proactive check-in. All gating that can be expressed in
 * SQL happens here — silence since last message, cadence since last proactive
 * contact, absence of an active high/critical risk signal, and onboarding participation
 * (no onboarding_states row, or participation 'active'). The per-user
 * quiet-hours guard (which needs timezone math) is applied by the use case.
 *
 * The cadence clauses are a prefilter: each row also carries the cadence facts
 * (same message filters as the WHERE clause) so the use case can re-decide with
 * the pure `checkInCadencePolicy` (Story 12.6).
 */
@Injectable()
export class ProactiveSchedulerRepository implements ProactiveSchedulerRepositoryPort {
  constructor(private readonly db: DatabaseService) {}

  async findCheckInCandidates(params: FindCheckInCandidatesParams): Promise<CheckInCandidate[]> {
    const tenantFilter = params.tenantId
      ? sql`AND u.tenant_id = ${params.tenantId}`
      : sql``;
    const qaCadence = sql`EXISTS (
      SELECT 1 FROM survey_reporting_cohorts cohort
      WHERE cohort.id::text = t.proactive_messaging_policy->>'qaThreePerDayCohortId'
        AND cohort.tenant_id = u.tenant_id
        AND u.id = ANY(cohort.roster_user_ids)
        AND now() >= cohort.period_start AND now() < cohort.period_end
    )`;

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
        COALESCE(wc.external_workspace_id, 'dev-workspace') AS external_workspace_id,
        (SELECT max(fi.occurred_at) FROM messages fi
          WHERE fi.tenant_id = u.tenant_id AND fi.user_id = u.id
            AND fi.direction = 'inbound' AND fi.text <> '__init__') AS last_inbound_at,
        (SELECT max(fc.occurred_at) FROM messages fc
          WHERE fc.tenant_id = u.tenant_id AND fc.user_id = u.id
            AND (
              (
                fc.direction = 'outbound'
                AND fc.message_type IN ('proactive_check_in', 'proactive_follow_up', 'reminder')
              )
              OR (
                fc.direction = 'inbound'
                AND fc.sender_type = 'system'
                AND fc.message_type = 'proactive_check_in_request'
              )
            )) AS last_proactive_contact_at,
        (SELECT count(*)::int FROM messages fr
          WHERE fr.tenant_id = u.tenant_id AND fr.user_id = u.id
            AND fr.direction = 'outbound'
            AND fr.message_type IN ('proactive_check_in', 'proactive_follow_up', 'reminder')
            AND fr.occurred_at > now() - interval '24 hours') AS recent_proactive_count,
        EXISTS (
          SELECT 1 FROM messages fu
          WHERE fu.tenant_id = u.tenant_id AND fu.user_id = u.id
            AND fu.direction = 'outbound'
            AND fu.message_type IN ('proactive_check_in', 'proactive_follow_up', 'reminder')
            AND NOT EXISTS (
              SELECT 1 FROM messages fur
              WHERE fur.tenant_id = u.tenant_id AND fur.user_id = u.id
                AND fur.direction = 'inbound' AND fur.text <> '__init__'
                AND fur.occurred_at > fu.occurred_at
            )
        ) AS has_unanswered_proactive,
        ${qaCadence} AS in_qa_cadence_cohort
      FROM users u
      JOIN tenants t ON t.id = u.tenant_id
      JOIN LATERAL (
        SELECT id, channel_type, external_conversation_id
        FROM conversations
        WHERE user_id = u.id AND status = 'active'
        ORDER BY created_at DESC
        LIMIT 1
      ) c ON true
      LEFT JOIN people p ON p.id = u.id AND p.tenant_id = u.tenant_id
      LEFT JOIN workspace_connections wc
        ON wc.tenant_id = u.tenant_id AND wc.channel_type = c.channel_type AND wc.status = 'active'
      WHERE u.status = 'active'
        AND u.proactive_messaging_enabled = true
        AND (p.id IS NULL OR p.pulse_participant = true)
        AND NOT EXISTS (
          SELECT 1 FROM onboarding_states os
          WHERE os.tenant_id = u.tenant_id AND os.person_id = u.id AND os.participation <> 'active'
        )
        ${tenantFilter}
        AND NOT EXISTS (
          SELECT 1 FROM messages m
          WHERE m.tenant_id = u.tenant_id AND m.user_id = u.id
            AND m.direction = 'inbound' AND m.text <> '__init__'
            AND m.occurred_at > now() - CASE WHEN ${qaCadence}
              THEN interval '2 hours' ELSE make_interval(days => ${params.minSilenceDays}) END
        )
        AND NOT EXISTS (
          SELECT 1 FROM messages m
          WHERE m.tenant_id = u.tenant_id AND m.user_id = u.id
            AND (
              (
                m.direction = 'outbound'
                AND m.message_type IN ('proactive_check_in', 'proactive_follow_up', 'reminder')
              )
              OR (
                m.direction = 'inbound'
                AND m.sender_type = 'system'
                AND m.message_type = 'proactive_check_in_request'
              )
            )
            AND m.occurred_at > now() - CASE WHEN ${qaCadence}
              THEN interval '4 hours' ELSE make_interval(days => ${params.minCheckInGapDays}) END
        )
        AND (NOT ${qaCadence} OR (
          (SELECT count(*) FROM messages recent
            WHERE recent.tenant_id = u.tenant_id AND recent.user_id = u.id
              AND recent.direction = 'outbound'
              AND recent.message_type IN ('proactive_check_in', 'proactive_follow_up', 'reminder')
              AND recent.occurred_at > now() - interval '24 hours') < 3
          AND NOT EXISTS (
            SELECT 1 FROM messages unanswered
            WHERE unanswered.tenant_id = u.tenant_id AND unanswered.user_id = u.id
              AND unanswered.direction = 'outbound'
              AND unanswered.message_type IN ('proactive_check_in', 'proactive_follow_up', 'reminder')
              AND NOT EXISTS (
                SELECT 1 FROM messages reply
                WHERE reply.tenant_id = u.tenant_id AND reply.user_id = u.id
                  AND reply.direction = 'inbound' AND reply.text <> '__init__'
                  AND reply.occurred_at > unanswered.occurred_at
              )
          )
        ))
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
      cadence: {
        lastInboundAt: toDateOrNull(r.last_inbound_at),
        lastProactiveContactAt: toDateOrNull(r.last_proactive_contact_at),
        recentProactiveCount: Number(r.recent_proactive_count),
        hasUnansweredProactive: r.has_unanswered_proactive,
        inQaCadenceCohort: r.in_qa_cadence_cohort,
      },
    }));
  }
}
