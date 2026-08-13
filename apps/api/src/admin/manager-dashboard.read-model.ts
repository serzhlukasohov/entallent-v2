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
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable()
export class ManagerDashboardReadModel {
  constructor(
    private readonly db: DatabaseService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async getTeamOverview(tenantId: unknown): Promise<AdminManagerTeamResponse> {
    const input = resolveManagerTeamInput(tenantId);
    const [userRows, channelAccountRows] = await Promise.all([
      this.db.client
        .select({ id: users.id, preferredName: users.preferredName })
        .from(users)
        .where(and(eq(users.tenantId, input.tenantId), eq(users.status, 'active'))),
      this.db.client
        .select({ userId: channelAccounts.userId, displayName: channelAccounts.displayName })
        .from(channelAccounts)
        .where(eq(channelAccounts.tenantId, input.tenantId)),
    ]);

    const teamUsers = attachTeamDisplayNames(userRows, channelAccountRows);

    if (!teamUsers.length) {
      return buildEmptyTeamOverview(input.tenantId);
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
            eq(messages.tenantId, input.tenantId),
            eq(messages.direction, 'inbound'),
            isNull(messages.deletedAt),
          ),
        )
        .orderBy(messages.userId, desc(messages.occurredAt)),

      this.db.client
        .selectDistinctOn([riskSignals.userId], { userId: riskSignals.userId })
        .from(riskSignals)
        .where(and(eq(riskSignals.tenantId, input.tenantId), eq(riskSignals.status, 'active'))),

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
        .where(and(eq(surveyWindows.tenantId, input.tenantId), eq(surveyWindows.status, 'active'))),

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
            eq(surveyWindows.tenantId, input.tenantId),
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
      tenantId: input.tenantId,
      teamSize: teamUsers.length,
      employees,
      generatedAt: new Date().toISOString(),
    };
  }

  async getTrends(tenantId: unknown, daysRaw?: unknown): Promise<TrendsResult> {
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

export function resolveManagerTeamInput(tenantId: unknown): { tenantId: string } {
  return { tenantId: normalizeTenantId(tenantId, 'tenantId query param is required') };
}

export function resolveManagerTrendsInput(
  tenantId: unknown,
  daysRaw: unknown,
  defaultTenantId: unknown,
): { tenantId: string; days: number } {
  const tenantSource = tenantId === undefined ? defaultTenantId : tenantId;

  return {
    tenantId: normalizeTenantId(tenantSource, 'tenantId query param is required'),
    days: resolveDays(daysRaw),
  };
}

function normalizeTenantId(value: unknown, missingMessage: string): string {
  if (value === undefined) {
    throw new BadRequestException(missingMessage);
  }
  if (typeof value !== 'string') {
    throw new BadRequestException('tenantId query param must be a valid UUID');
  }

  const tenantId = value.trim();
  if (!tenantId) {
    throw new BadRequestException(missingMessage);
  }
  if (!UUID_RE.test(tenantId)) {
    throw new BadRequestException('tenantId query param must be a valid UUID');
  }

  return tenantId;
}

function resolveDays(raw?: unknown): number {
  if (raw !== undefined && typeof raw !== 'string') {
    throw new BadRequestException('days query param must be an integer');
  }
  if (raw === undefined || raw.trim() === '') return DEFAULT_DAYS;

  const normalized = raw.trim();
  if (!/^\d+$/.test(normalized)) {
    throw new BadRequestException('days query param must be an integer');
  }

  const n = Number(normalized);
  if (n < 1) {
    throw new BadRequestException('days query param must be at least 1');
  }

  return Math.min(n, MAX_DAYS);
}
