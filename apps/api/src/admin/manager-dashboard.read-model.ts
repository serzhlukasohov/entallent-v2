import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, desc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import type { Env } from '@entalent/config';
import type { AdminManagerTeamResponse } from '@entalent/contracts';
import {
  channelAccounts,
  eligiblePulsePersonOrLegacy,
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
  dateRange,
  type EngagementRow,
  type FunnelRow,
  type QuestionRow,
  type SignalRow,
  type TrendsResult,
} from './manager-trends.aggregate';
import { attachTeamDisplayNames } from './team-users';

const DEFAULT_DAYS = 14;
const MAX_DAYS = 120;
const MIN_COHORT_SIZE = 5;
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
        .where(and(eq(users.tenantId, input.tenantId), eq(users.status, 'active'),
          isNull(users.deletedAt), eligiblePulsePersonOrLegacy(users.id, users.tenantId))),
      this.db.client
        .select({ userId: channelAccounts.userId, displayName: channelAccounts.displayName })
        .from(channelAccounts)
        .where(and(eq(channelAccounts.tenantId, input.tenantId),
          eq(channelAccounts.linkStatus, 'linked'))),
    ]);

    const teamUsers = attachTeamDisplayNames(userRows, channelAccountRows);

    if (!teamUsers.length) {
      return buildEmptyTeamOverview(input.tenantId);
    }

    const [lastMessages, activeRiskUserIds, surveyRows, evidenceRows, previousWindows] = await Promise.all([
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

      this.db.client
        .selectDistinctOn([surveyWindows.userId], {
          userId: surveyWindows.userId,
          windowId: surveyWindows.id,
          completedAt: surveyWindows.completedAt,
        })
        .from(surveyWindows)
        .innerJoin(surveyAssessments, eq(surveyAssessments.surveyWindowId, surveyWindows.id))
        .where(
          and(
            eq(surveyWindows.tenantId, input.tenantId),
            eq(surveyWindows.status, 'closed'),
            isNotNull(surveyWindows.completedAt),
          ),
        )
        .orderBy(surveyWindows.userId, desc(surveyWindows.completedAt)),
    ]);

    const previousWindowIds = previousWindows.map((window) => window.windowId);
    const [previousSurveyRows, previousEvidenceRows] = previousWindowIds.length > 0
      ? await Promise.all([
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
            .where(inArray(surveyWindows.id, previousWindowIds)),
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
            .where(
              and(
                inArray(surveyEvidence.surveyWindowId, previousWindowIds),
                isNull(surveyEvidence.supersededAt),
              ),
            )
            .orderBy(desc(surveyEvidence.strength)),
        ])
      : [[], []];

    const employees = buildEmployeeRows({
      teamUsers,
      lastMessages,
      activeRiskUserIds,
      assessments: surveyRows,
      evidence: evidenceRows,
      previousWindows,
      previousAssessments: previousSurveyRows,
      previousEvidence: previousEvidenceRows,
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
        SELECT to_char(activity.day, 'YYYY-MM-DD') AS day,
               count(DISTINCT activity.user_id)::int AS "activeUsers",
               sum(activity.inbound_non_init_count)::int AS "inboundMessages"
        FROM conversation_activity_daily activity
        JOIN users activity_owner ON activity_owner.id = activity.user_id
          AND activity_owner.tenant_id = activity.tenant_id
        WHERE activity.tenant_id = ${input.tenantId}
          AND ${eligiblePulsePersonOrLegacy(sql`activity.user_id`, sql`activity.tenant_id`)}
          AND activity.inbound_non_init_count > 0
          AND activity.day >= ((${since}) AT TIME ZONE 'UTC')::date
        GROUP BY 1
        ORDER BY 1
      `) as unknown as Promise<EngagementRow[]>,

      this.db.client.execute(sql`
        SELECT to_char(date_trunc('day', e.created_at), 'YYYY-MM-DD') AS day,
               e.polarity AS polarity,
               count(*)::int AS count,
               count(DISTINCT e.user_id)::int AS "cohortUsers"
        FROM survey_evidence e
        JOIN survey_windows w ON e.survey_window_id = w.id
        JOIN users window_owner ON window_owner.id = w.user_id
          AND window_owner.tenant_id = w.tenant_id
        JOIN survey_questions q ON e.survey_question_id = q.id
          AND q.survey_definition_id = w.survey_definition_id
        JOIN survey_definitions d ON d.id = w.survey_definition_id
          AND (d.tenant_id IS NULL OR d.tenant_id = w.tenant_id)
        WHERE w.tenant_id = ${input.tenantId}
          AND e.user_id = w.user_id
          AND ${eligiblePulsePersonOrLegacy(sql`e.user_id`, sql`w.tenant_id`)}
          AND NOT EXISTS (
            SELECT 1 FROM survey_window_scoring_policies v2
            WHERE v2.survey_window_id = w.id AND v2.tenant_id = w.tenant_id
          )
          AND e.created_at >= date_trunc('day', ${since})
        GROUP BY 1, 2
        ORDER BY 1
      `) as unknown as Promise<Array<SignalRow & { cohortUsers: number }>>,

      this.db.client.execute(sql`
        SELECT a.status AS status, count(*)::int AS count,
               count(DISTINCT w.user_id)::int AS "cohortUsers"
        FROM survey_assessments a
        JOIN survey_windows w ON a.survey_window_id = w.id
        JOIN users window_owner ON window_owner.id = w.user_id
          AND window_owner.tenant_id = w.tenant_id
        JOIN survey_questions q ON a.survey_question_id = q.id
          AND q.survey_definition_id = w.survey_definition_id
        JOIN survey_definitions d ON d.id = w.survey_definition_id
          AND (d.tenant_id IS NULL OR d.tenant_id = w.tenant_id)
        WHERE w.tenant_id = ${input.tenantId} AND w.status = 'active'
          AND ${eligiblePulsePersonOrLegacy(sql`w.user_id`, sql`w.tenant_id`)}
          AND NOT EXISTS (
            SELECT 1 FROM survey_window_scoring_policies v2
            WHERE v2.survey_window_id = w.id AND v2.tenant_id = w.tenant_id
          )
        GROUP BY 1
      `) as unknown as Promise<Array<FunnelRow & { cohortUsers: number }>>,

      this.db.client.execute(sql`
        SELECT q.stable_key AS "stableKey",
               q.title AS title,
               q.dimension AS dimension,
               e.polarity AS polarity,
               count(*)::int AS count,
               count(DISTINCT e.user_id)::int AS "cohortUsers"
        FROM survey_evidence e
        JOIN survey_windows w ON e.survey_window_id = w.id
        JOIN users window_owner ON window_owner.id = w.user_id
          AND window_owner.tenant_id = w.tenant_id
        JOIN survey_questions q ON e.survey_question_id = q.id
          AND q.survey_definition_id = w.survey_definition_id
        JOIN survey_definitions d ON d.id = w.survey_definition_id
          AND (d.tenant_id IS NULL OR d.tenant_id = w.tenant_id)
        WHERE w.tenant_id = ${input.tenantId}
          AND e.user_id = w.user_id
          AND w.status = 'active'
          AND ${eligiblePulsePersonOrLegacy(sql`e.user_id`, sql`w.tenant_id`)}
          AND NOT EXISTS (
            SELECT 1 FROM survey_window_scoring_policies v2
            WHERE v2.survey_window_id = w.id AND v2.tenant_id = w.tenant_id
          )
          AND e.superseded_at IS NULL
        GROUP BY 1, 2, 3, e.polarity
      `) as unknown as Promise<Array<QuestionRow & { cohortUsers: number }>>,
    ]);

    // A breakdown with fewer than five distinct employees could identify a person.
    // Hide the entire response so the dashboard never presents suppressed cells as zero.
    if (engagement.some((row) => row.activeUsers < MIN_COHORT_SIZE)
      || [...signals, ...funnel, ...questions].some((row) =>
        !Number.isInteger(row.cohortUsers) || row.cohortUsers < MIN_COHORT_SIZE)) {
      const dates = dateRange(new Date().toISOString().slice(0, 10), input.days);
      return {
        rangeStart: dates[0],
        rangeEnd: dates[dates.length - 1],
        suppressed: true,
        engagement: [],
        signalCapture: [],
        coverageFunnel: {},
        questionSentiment: [],
      };
    }

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
