import { Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { surveyReportingCohorts, surveyWindows, teams, teamMemberships } from '@entalent/database';
import { DatabaseService } from '../../database/database.service';

type TeamInfo = {
  teamId: string;
  tenantId: string;
  teamName: string;
  managerSlackUserId: string | null;
  activeTeamSize: number;
  memberUserIds: string[];
  reportingCohortId: string | null;
  reportingSurveyDefinitionId: string | null;
  reportingPeriodStart: Date | null;
  reportingPeriodEnd: Date | null;
};

@Injectable()
export class TeamRepository {
  constructor(private readonly db: DatabaseService) {}

  async findTeamByMemberId(
    userId: string,
    tenantId: string,
    surveyWindowId?: string,
  ): Promise<TeamInfo | null> {
    if (surveyWindowId) {
      const [window] = await this.db.client
        .select({
          reportingCohortId: surveyWindows.reportingCohortId,
          teamId: surveyReportingCohorts.teamId,
          memberUserIds: surveyReportingCohorts.rosterUserIds,
        })
        .from(surveyWindows)
        .innerJoin(
          surveyReportingCohorts,
          eq(surveyReportingCohorts.id, surveyWindows.reportingCohortId),
        )
        .where(and(
          eq(surveyWindows.id, surveyWindowId),
          eq(surveyWindows.tenantId, tenantId),
          eq(surveyWindows.userId, userId),
        ))
        .limit(1);
      return window?.teamId && window.reportingCohortId && window.memberUserIds.includes(userId)
        ? this.findTeamById(window.teamId, tenantId, window.reportingCohortId)
        : null;
    }

    const [membership] = await this.db.client
      .select({ teamId: teamMemberships.teamId })
      .from(teamMemberships)
      .innerJoin(teams, eq(teams.id, teamMemberships.teamId))
      .where(
        and(
          eq(teamMemberships.userId, userId),
          eq(teamMemberships.role, 'member'),
          isNull(teamMemberships.leftAt),
          eq(teams.tenantId, tenantId),
        ),
      )
      .limit(1);

    if (!membership) return null;

    return this.findTeamById(membership.teamId, tenantId);
  }

  async findTeamById(teamId: string, tenantId: string, reportingCohortId?: string): Promise<TeamInfo | null> {
    const [team] = await this.db.client
      .select()
      .from(teams)
      .where(and(eq(teams.id, teamId), eq(teams.tenantId, tenantId)))
      .limit(1);

    if (!team) return null;

    if (reportingCohortId) {
      const [cohort] = await this.db.client
        .select({
          reportingCohortId: surveyReportingCohorts.id,
          memberUserIds: surveyReportingCohorts.rosterUserIds,
          reportingSurveyDefinitionId: surveyReportingCohorts.surveyDefinitionId,
          reportingPeriodStart: surveyReportingCohorts.periodStart,
          reportingPeriodEnd: surveyReportingCohorts.periodEnd,
        })
        .from(surveyReportingCohorts)
        .where(and(
          eq(surveyReportingCohorts.id, reportingCohortId),
          eq(surveyReportingCohorts.tenantId, tenantId),
          eq(surveyReportingCohorts.teamId, teamId),
        ))
        .limit(1);
      if (!cohort) return null;
      return this.toTeamInfo(
        team,
        cohort.memberUserIds,
        cohort.reportingCohortId,
        cohort.reportingSurveyDefinitionId,
        cohort.reportingPeriodStart,
        cohort.reportingPeriodEnd,
      );
    }

    const members = await this.db.client
      .select({ userId: teamMemberships.userId })
      .from(teamMemberships)
      .where(
        and(
          eq(teamMemberships.teamId, teamId),
          eq(teamMemberships.role, 'member'),
          isNull(teamMemberships.leftAt),
        ),
      );

    return this.toTeamInfo(team, members.map((member) => member.userId), null, null, null, null);
  }

  private toTeamInfo(
    team: typeof teams.$inferSelect,
    userIds: string[],
    reportingCohortId: string | null,
    reportingSurveyDefinitionId: string | null,
    reportingPeriodStart: Date | null,
    reportingPeriodEnd: Date | null,
  ): TeamInfo {
    const memberUserIds = [...new Set(userIds)].sort();
    return {
      teamId: team.id,
      tenantId: team.tenantId,
      teamName: team.name,
      managerSlackUserId: team.managerSlackUserId,
      activeTeamSize: memberUserIds.length,
      memberUserIds,
      reportingCohortId,
      reportingSurveyDefinitionId,
      reportingPeriodStart,
      reportingPeriodEnd,
    };
  }
}
