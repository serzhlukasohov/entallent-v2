import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { and, eq, gte, isNull, sql } from 'drizzle-orm';
import { messages, users, riskSignals, surveyAssessments, surveyWindows } from '@entalent/database';
import { ApiKeyGuard } from '../auth/api-key.guard';
import { DatabaseService } from '../database/database.service';

const MIN_COHORT_SIZE = 5;

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

@Controller('admin/analytics')
@UseGuards(ApiKeyGuard)
export class AnalyticsController {
  constructor(private readonly db: DatabaseService) {}

  @Get()
  async overview(
    @Query('tenantId') tenantId?: string,
  ): Promise<Record<string, unknown>> {
    const [
      activeUsers7d,
      activeUsers30d,
      messageCounts,
      totalUsers,
      activeRiskCounts,
      surveyStats,
    ] = await Promise.all([
      // Active users last 7 days (inbound messages)
      this.db.client
        .select({ count: sql<number>`count(distinct ${messages.userId})::int` })
        .from(messages)
        .where(
          and(
            tenantId ? eq(messages.tenantId, tenantId) : undefined,
            gte(messages.occurredAt, daysAgo(7)),
            eq(messages.direction, 'inbound'),
            isNull(messages.deletedAt),
          ),
        ),

      // Active users last 30 days
      this.db.client
        .select({ count: sql<number>`count(distinct ${messages.userId})::int` })
        .from(messages)
        .where(
          and(
            tenantId ? eq(messages.tenantId, tenantId) : undefined,
            gte(messages.occurredAt, daysAgo(30)),
            eq(messages.direction, 'inbound'),
            isNull(messages.deletedAt),
          ),
        ),

      // Message volume by direction (last 30 days)
      this.db.client
        .select({
          direction: messages.direction,
          count: sql<number>`count(*)::int`,
        })
        .from(messages)
        .where(
          and(
            tenantId ? eq(messages.tenantId, tenantId) : undefined,
            gte(messages.occurredAt, daysAgo(30)),
            isNull(messages.deletedAt),
          ),
        )
        .groupBy(messages.direction),

      // Total users
      this.db.client
        .select({ count: sql<number>`count(*)::int` })
        .from(users)
        .where(
          and(
            tenantId ? eq(users.tenantId, tenantId) : undefined,
            eq(users.status, 'active'),
          ),
        ),

      // Active risk signals by severity
      this.db.client
        .select({
          severity: riskSignals.severity,
          count: sql<number>`count(*)::int`,
        })
        .from(riskSignals)
        .where(
          and(
            tenantId ? eq(riskSignals.tenantId, tenantId) : undefined,
            eq(riskSignals.status, 'active'),
          ),
        )
        .groupBy(riskSignals.severity),

      // Survey: users with at least one 'scored' assessment this quarter
      this.db.client
        .select({ count: sql<number>`count(distinct ${surveyWindows.userId})::int` })
        .from(surveyAssessments)
        .innerJoin(surveyWindows, eq(surveyAssessments.surveyWindowId, surveyWindows.id))
        .where(
          and(
            tenantId ? eq(surveyWindows.tenantId, tenantId) : undefined,
            eq(surveyWindows.status, 'active'),
            eq(surveyAssessments.status, 'scored'),
          ),
        ),
    ]);

    const totalUserCount = totalUsers[0]?.count ?? 0;
    const dau = activeUsers7d[0]?.count ?? 0;
    const mau = activeUsers30d[0]?.count ?? 0;
    const surveyedUsers = surveyStats[0]?.count ?? 0;

    // Apply cohort safety: suppress user-level data if cohort is too small
    if (totalUserCount < MIN_COHORT_SIZE) {
      return {
        cohortInsufficient: true,
        minimumCohortSize: MIN_COHORT_SIZE,
        note: 'Analytics suppressed: insufficient cohort size to prevent re-identification.',
      };
    }

    const msgByDirection: Record<string, number> = {};
    for (const row of messageCounts) {
      msgByDirection[row.direction] = row.count;
    }

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
