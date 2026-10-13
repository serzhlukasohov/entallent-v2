import { BadRequestException, Controller, Get, Query, UseGuards } from '@nestjs/common';
import { and, eq, gt, gte, isNull, or, sql } from 'drizzle-orm';
import { conversationActivityDaily, eligiblePulsePersonOrLegacy, users, riskSignals, surveyAssessments, surveyDefinitions, surveyQuestions, surveyWindows } from '@entalent/database';
import { ApiKeyGuard } from '../auth/api-key.guard';
import { DatabaseService } from '../database/database.service';

const MIN_COHORT_SIZE = 5;

function utcDayAgo(n: number): string {
  const day = new Date();
  day.setUTCHours(0, 0, 0, 0);
  day.setUTCDate(day.getUTCDate() - (n - 1));
  return day.toISOString().slice(0, 10);
}

@Controller('admin/analytics')
@UseGuards(ApiKeyGuard)
export class AnalyticsController {
  constructor(private readonly db: DatabaseService) {}

  @Get()
  async overview(
    @Query('tenantId') tenantId?: string,
  ): Promise<Record<string, unknown>> {
    if (!tenantId?.trim()) {
      throw new BadRequestException('tenantId query param is required');
    }
    const [
      activeUsers7d,
      activeUsers30d,
      messageCounts,
      totalUsers,
      activeRiskCounts,
      surveyStats,
    ] = await Promise.all([
      // Content-free runtime projection; this reader never opens conversation messages.
      this.db.client
        .select({ count: sql<number>`count(distinct ${conversationActivityDaily.userId})::int` })
        .from(conversationActivityDaily)
        .innerJoin(users, and(eq(users.id, conversationActivityDaily.userId),
          eq(users.tenantId, conversationActivityDaily.tenantId)))
        .where(
          and(
            eq(conversationActivityDaily.tenantId, tenantId),
            gte(conversationActivityDaily.day, utcDayAgo(7)),
            gt(conversationActivityDaily.inboundCount, 0),
            eligiblePulsePersonOrLegacy(conversationActivityDaily.userId, conversationActivityDaily.tenantId),
          ),
        ),

      // Active users in the last 30 UTC calendar days.
      this.db.client
        .select({ count: sql<number>`count(distinct ${conversationActivityDaily.userId})::int` })
        .from(conversationActivityDaily)
        .innerJoin(users, and(eq(users.id, conversationActivityDaily.userId),
          eq(users.tenantId, conversationActivityDaily.tenantId)))
        .where(
          and(
            eq(conversationActivityDaily.tenantId, tenantId),
            gte(conversationActivityDaily.day, utcDayAgo(30)),
            gt(conversationActivityDaily.inboundCount, 0),
            eligiblePulsePersonOrLegacy(conversationActivityDaily.userId, conversationActivityDaily.tenantId),
          ),
        ),

      // Message volume by direction from content-free daily counters.
      this.db.client
        .select({
          inbound: sql<number>`coalesce(sum(${conversationActivityDaily.inboundCount}), 0)::int`,
          outbound: sql<number>`coalesce(sum(${conversationActivityDaily.outboundCount}), 0)::int`,
          inboundUsers: sql<number>`count(distinct case when ${conversationActivityDaily.inboundCount} > 0 then ${conversationActivityDaily.userId} end)::int`,
          outboundUsers: sql<number>`count(distinct case when ${conversationActivityDaily.outboundCount} > 0 then ${conversationActivityDaily.userId} end)::int`,
        })
        .from(conversationActivityDaily)
        .innerJoin(users, and(eq(users.id, conversationActivityDaily.userId),
          eq(users.tenantId, conversationActivityDaily.tenantId)))
        .where(
          and(
            eq(conversationActivityDaily.tenantId, tenantId),
            gte(conversationActivityDaily.day, utcDayAgo(30)),
            eligiblePulsePersonOrLegacy(conversationActivityDaily.userId, conversationActivityDaily.tenantId),
          ),
        ),

      // Total users
      this.db.client
        .select({ count: sql<number>`count(*)::int` })
        .from(users)
        .where(
          and(
            eq(users.tenantId, tenantId),
            eq(users.status, 'active'),
            isNull(users.deletedAt),
            eligiblePulsePersonOrLegacy(users.id, users.tenantId),
          ),
        ),

      // Active risk signals by severity
      this.db.client
        .select({
          severity: riskSignals.severity,
          count: sql<number>`count(*)::int`,
          contributorCount: sql<number>`count(distinct ${riskSignals.userId})::int`,
        })
        .from(riskSignals)
        .innerJoin(users, and(eq(users.id, riskSignals.userId), eq(users.tenantId, riskSignals.tenantId)))
        .where(
          and(
            eq(riskSignals.tenantId, tenantId),
            eq(riskSignals.status, 'active'),
            eligiblePulsePersonOrLegacy(riskSignals.userId, riskSignals.tenantId),
          ),
        )
        .groupBy(riskSignals.severity),

      // Survey: users with at least one 'scored' assessment this quarter
      this.db.client
        .select({ count: sql<number>`count(distinct ${surveyWindows.userId})::int` })
        .from(surveyAssessments)
        .innerJoin(surveyWindows, eq(surveyAssessments.surveyWindowId, surveyWindows.id))
        .innerJoin(users, and(eq(users.id, surveyWindows.userId), eq(users.tenantId, surveyWindows.tenantId)))
        .innerJoin(surveyQuestions, and(
          eq(surveyAssessments.surveyQuestionId, surveyQuestions.id),
          eq(surveyQuestions.surveyDefinitionId, surveyWindows.surveyDefinitionId),
        ))
        .innerJoin(surveyDefinitions, and(
          eq(surveyDefinitions.id, surveyWindows.surveyDefinitionId),
          or(isNull(surveyDefinitions.tenantId), eq(surveyDefinitions.tenantId, surveyWindows.tenantId)),
        ))
        .where(
          and(
            eq(surveyWindows.tenantId, tenantId),
            eq(surveyWindows.status, 'active'),
            eq(surveyAssessments.status, 'scored'),
            eligiblePulsePersonOrLegacy(surveyWindows.userId, surveyWindows.tenantId),
            sql`NOT EXISTS (SELECT 1 FROM survey_window_scoring_policies v2
              WHERE v2.survey_window_id = ${surveyWindows.id}
                AND v2.tenant_id = ${surveyWindows.tenantId})`,
          ),
        ),
    ]);

    const totalUserCount = totalUsers[0]?.count ?? 0;
    const dau = activeUsers7d[0]?.count ?? 0;
    const mau = activeUsers30d[0]?.count ?? 0;
    const surveyedUsers = surveyStats[0]?.count ?? 0;

    const positiveBelowMinimum = (count: number) => count > 0 && count < MIN_COHORT_SIZE;
    const messageContributors = messageCounts[0];
    if (totalUserCount < MIN_COHORT_SIZE
      || [dau, mau, surveyedUsers, messageContributors?.inboundUsers ?? 0,
        messageContributors?.outboundUsers ?? 0].some(positiveBelowMinimum)
      || activeRiskCounts.some((row) => positiveBelowMinimum(row.contributorCount))) {
      return {
        cohortInsufficient: true,
        minimumCohortSize: MIN_COHORT_SIZE,
        note: 'Analytics suppressed: an output group has insufficient contributors.',
      };
    }

    const msgByDirection: Record<string, number> = {
      inbound: messageCounts[0]?.inbound ?? 0,
      outbound: messageCounts[0]?.outbound ?? 0,
    };

    const riskByLevel: Record<string, number> = {};
    for (const row of activeRiskCounts) {
      riskByLevel[row.severity] = row.count;
    }

    return {
      users: {
        total: totalUserCount,
        activeLast7Days: dau,
        activeLast30Days: mau,
        dau7dToMau: mau > 0 ? Math.round((dau / mau) * 100) / 100 : 0,
      },
      messages: {
        last30Days: msgByDirection,
        totalLast30Days: Object.values(msgByDirection).reduce((a, b) => a + b, 0),
      },
      survey: {
        usersWithScoredAssessments: surveyedUsers,
        coverageRate: totalUserCount > 0 ? Math.round((surveyedUsers / totalUserCount) * 100) / 100 : 0,
      },
      safety: {
        activeRiskSignalsBySeverity: riskByLevel,
        totalActiveRiskSignals: Object.values(riskByLevel).reduce((a, b) => a + b, 0),
      },
      generatedAt: new Date().toISOString(),
    };
  }
}
