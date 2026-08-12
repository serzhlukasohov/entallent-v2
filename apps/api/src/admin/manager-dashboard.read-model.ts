import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import type { Env } from '@entalent/config';
import type { AdminManagerTeamResponse } from '@entalent/contracts';
import {
  channelAccounts,
  messages,
  riskSignals,
  surveyAssessments,
  surveyEvidence,
  surveyQuestions,
  surveyWindows,
  users,
} from '@entalent/database';
import { DatabaseService } from '../database/database.service';
import { buildEmployeeRows } from './manager-team.aggregate';
import {
  buildTrends,
  type EngagementRow,
  type FunnelRow,
  type QuestionRow,
  type SignalRow,
  type TrendsResult,
} from './manager-trends.aggregate';
import { attachTeamDisplayNames } from './team-users';

const DEFAULT_DAYS = 14;
const MAX_DAYS = 120;

@Injectable()
export class ManagerDashboardReadModel {
  constructor(
    private readonly db: DatabaseService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async getTeamOverview(tenantId: string): Promise<AdminManagerTeamResponse> {
    const [userRows, channelAccountRows] = await Promise.all([
      this.db.client
        .select({ id: users.id, preferredName: users.preferredName })
        .from(users)
        .where(and(eq(users.tenantId, tenantId), eq(users.status, 'active'))),
      this.db.client
        .select({ userId: channelAccounts.userId, displayName: channelAccounts.displayName })
        .from(channelAccounts)
        .where(eq(channelAccounts.tenantId, tenantId)),
    ]);

    const teamUsers = attachTeamDisplayNames(userRows, channelAccountRows);

    if (!teamUsers.length) {
      return buildEmptyTeamOverview(tenantId);
    }

    const [lastMessages, activeRiskUserIds, surveyRows, evidenceRows] = await Promise.all([
      this.db.client
        .selectDistinctOn([messages.userId], {
          userId: messages.userId,
          occurredAt: messages.occurredAt,
        })
        .from(messages)
        .where(
          and(
            eq(messages.tenantId, tenantId),
            eq(messages.direction, 'inbound'),
            isNull(messages.deletedAt),
          ),
        )
        .orderBy(messages.userId, desc(messages.occurredAt)),

      this.db.client
        .selectDistinctOn([riskSignals.userId], { userId: riskSignals.userId })
        .from(riskSignals)
        .where(and(eq(riskSignals.tenantId, tenantId), eq(riskSignals.status, 'active'))),

      this.db.client
        .select({
          userId: surveyWindows.userId,
          windowId: surveyWindows.id,
          questionId: surveyQuestions.id,
          stableKey: surveyQuestions.stableKey,
          title: surveyQuestions.title,
          dimension: surveyQuestions.dimension,
          assessmentStatus: surveyAssessments.status,
          assessmentConfidence: surveyAssessments.confidence,
        })
        .from(surveyAssessments)
        .innerJoin(surveyWindows, eq(surveyAssessments.surveyWindowId, surveyWindows.id))
        .innerJoin(surveyQuestions, eq(surveyAssessments.surveyQuestionId, surveyQuestions.id))
        .where(and(eq(surveyWindows.tenantId, tenantId), eq(surveyWindows.status, 'active'))),

      this.db.client
        .select({
          userId: surveyEvidence.userId,
          questionId: surveyEvidence.surveyQuestionId,
          polarity: surveyEvidence.polarity,
          strength: surveyEvidence.strength,
          confidence: surveyEvidence.confidence,
          evidenceSummary: surveyEvidence.evidenceSummary,
          createdAt: surveyEvidence.createdAt,
        })
        .from(surveyEvidence)
        .innerJoin(surveyWindows, eq(surveyEvidence.surveyWindowId, surveyWindows.id))
        .where(
          and(
            eq(surveyWindows.tenantId, tenantId),
            eq(surveyWindows.status, 'active'),
            isNull(surveyEvidence.supersededAt),
          ),
        )
        .orderBy(desc(surveyEvidence.strength)),
    ]);

    const employees = buildEmployeeRows({
      teamUsers,
      lastMessages,
      activeRiskUserIds,
      assessments: surveyRows,
      evidence: evidenceRows,
    });

    return {
      tenantId,
      teamSize: teamUsers.length,
      employees,
      generatedAt: new Date().toISOString(),
    };
  }

  async getTrends(tenantId: string | undefined, daysRaw?: string): Promise<TrendsResult> {
    const input = resolveManagerTrendsInput(
      tenantId,
      daysRaw,
      this.config.get('DEFAULT_TENANT_ID', { infer: true }),
    );
    const since = sql`now() - make_interval(days => ${input.days - 1})`;

    const [engagement, signals, funnel, questions] = await Promise.all([
      this.db.client.execute(sql`
        SELECT to_char(date_trunc('day', occurred_at), 'YYYY-MM-DD') AS day,
               count(DISTINCT user_id)::int AS "activeUsers",
               count(*)::int AS "inboundMessages"
        FROM messages
        WHERE tenant_id = ${input.tenantId}
          AND direction = 'inbound'
          AND text <> '__init__'
          AND deleted_at IS NULL
          AND occurred_at >= date_trunc('day', ${since})
        GROUP BY 1
        ORDER BY 1
      `) as unknown as Promise<EngagementRow[]>,

      this.db.client.execute(sql`
        SELECT to_char(date_trunc('day', e.created_at), 'YYYY-MM-DD') AS day,
               e.polarity AS polarity,
               count(*)::int AS count
        FROM survey_evidence e
        JOIN survey_windows w ON e.survey_window_id = w.id
        WHERE w.tenant_id = ${input.tenantId}
          AND e.created_at >= date_trunc('day', ${since})
        GROUP BY 1, 2
        ORDER BY 1
      `) as unknown as Promise<SignalRow[]>,

      this.db.client.execute(sql`
        SELECT a.status AS status, count(*)::int AS count
        FROM survey_assessments a
        JOIN survey_windows w ON a.survey_window_id = w.id
        WHERE w.tenant_id = ${input.tenantId} AND w.status = 'active'
        GROUP BY 1
      `) as unknown as Promise<FunnelRow[]>,

      this.db.client.execute(sql`
        SELECT q.stable_key AS "stableKey",
               q.title AS title,
               q.dimension AS dimension,
               e.polarity AS polarity,
               count(*)::int AS count
        FROM survey_evidence e
        JOIN survey_windows w ON e.survey_window_id = w.id
        JOIN survey_questions q ON e.survey_question_id = q.id
        WHERE w.tenant_id = ${input.tenantId}
          AND w.status = 'active'
          AND e.superseded_at IS NULL
        GROUP BY 1, 2, 3, e.polarity
      `) as unknown as Promise<QuestionRow[]>,
    ]);

    return buildTrends({
      rangeEnd: new Date().toISOString().slice(0, 10),
      days: input.days,
      engagement,
      signals,
      funnel,
      questions,
    });
  }
}

export function buildEmptyTeamOverview(tenantId: string): AdminManagerTeamResponse {
  return { tenantId, teamSize: 0, employees: [], generatedAt: new Date().toISOString() };
}

export function resolveManagerTrendsInput(
  tenantId: string | undefined,
  daysRaw: string | undefined,
  defaultTenantId: string | undefined,
): { tenantId: string; days: number } {
  const resolvedTenantId = tenantId ?? defaultTenantId;
  if (!resolvedTenantId) {
    throw new BadRequestException('tenantId query param is required');
  }

  return {
    tenantId: resolvedTenantId,
    days: clampDays(daysRaw),
  };
}

function clampDays(raw?: string): number {
  const n = raw ? parseInt(raw, 10) : DEFAULT_DAYS;
  if (isNaN(n) || n < 1) return DEFAULT_DAYS;
  return Math.min(n, MAX_DAYS);
}
