import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { and, desc, eq, isNull } from 'drizzle-orm';
import {
  channelAccounts,
  users,
  messages,
  riskSignals,
  surveyWindows,
  surveyAssessments,
  surveyQuestions,
  surveyEvidence,
} from '@entalent/database';
import type { AdminManagerTeamResponse } from '@entalent/contracts';
import { ApiKeyGuard } from '../auth/api-key.guard';
import { DatabaseService } from '../database/database.service';
import { buildEmployeeRows } from './manager-team.aggregate';
import { attachTeamDisplayNames } from './team-users';

@Controller('admin/manager/team')
@UseGuards(ApiKeyGuard)
export class ManagerTeamController {
  constructor(private readonly db: DatabaseService) {}

  @Get()
  async getTeamOverview(@Query('tenantId') tenantId: string): Promise<AdminManagerTeamResponse> {
    // All active users for the tenant
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
      return { tenantId, teamSize: 0, employees: [], generatedAt: new Date().toISOString() };
    }

    // Run all queries in parallel
    const [lastMessages, activeRiskUserIds, surveyRows, evidenceRows] = await Promise.all([
      // Last inbound message per user
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

      // Users with active risk signals
      this.db.client
        .selectDistinctOn([riskSignals.userId], { userId: riskSignals.userId })
        .from(riskSignals)
        .where(and(eq(riskSignals.tenantId, tenantId), eq(riskSignals.status, 'active'))),

      // All assessments in active windows for these users (with question metadata)
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

      // Active (non-superseded) evidence for all users in this tenant
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
}
