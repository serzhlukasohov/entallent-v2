import { Injectable } from '@nestjs/common';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import {
  channelAccounts, orgEmployeePlacements, orgTeams, orgUnits, people,
  surveyReportingCohorts, surveyWindows, teams, teamMemberships, users,
} from '@entalent/database';
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

  async findV2ManagerExternalUserId(
    teamId: string, tenantId: string, externalWorkspaceId: string,
  ): Promise<string | null> {
    const rows = await this.db.client.select({ externalUserId: channelAccounts.externalUserId })
      .from(teamMemberships)
      .innerJoin(teams, and(eq(teams.id, teamMemberships.teamId), eq(teams.tenantId, tenantId)))
      .innerJoin(users, and(eq(users.id, teamMemberships.userId), eq(users.tenantId, tenantId)))
      .innerJoin(channelAccounts, and(
        eq(channelAccounts.userId, users.id), eq(channelAccounts.tenantId, tenantId),
      ))
      .where(and(
        eq(teamMemberships.teamId, teamId), eq(teamMemberships.role, 'manager'),
        isNull(teamMemberships.leftAt), eq(users.status, 'active'), isNull(users.deletedAt),
        eq(channelAccounts.channelType, 'slack'), eq(channelAccounts.linkStatus, 'linked'),
        eq(channelAccounts.externalWorkspaceId, externalWorkspaceId),
      )).limit(2);
    return rows.length === 1 ? rows[0]!.externalUserId : null;
  }

  async findCurrentHierarchyIdentifiers(userId: string, tenantId: string): Promise<string[]> {
    const [person] = await this.db.client.select({ role: people.primaryRole }).from(people).where(and(
      eq(people.id, userId), eq(people.tenantId, tenantId),
      eq(people.lifecycleStatus, 'active'), eq(people.pulseParticipant, true),
    )).limit(1);
    if (!person) return [];

    const [placement] = person.role === 'employee'
      ? await this.db.client.select({ unitId: orgEmployeePlacements.unitId, teamId: orgEmployeePlacements.teamId })
        .from(orgEmployeePlacements).where(and(
          eq(orgEmployeePlacements.tenantId, tenantId),
          eq(orgEmployeePlacements.employeePersonId, userId),
          eq(orgEmployeePlacements.lifecycleStatus, 'active'),
        )).limit(1)
      : [];
    const [ownedTeam] = person.role === 'team_lead'
      ? await this.db.client.select({ id: orgTeams.id, unitId: orgTeams.unitId })
        .from(orgTeams).where(and(
          eq(orgTeams.tenantId, tenantId), eq(orgTeams.teamLeadPersonId, userId),
          eq(orgTeams.lifecycleStatus, 'active'),
        )).limit(1)
      : [];
    const unitId = placement?.unitId ?? ownedTeam?.unitId;
    const teamId = placement?.teamId ?? ownedTeam?.id ?? null;
    if (!unitId) return [];

    const [unit] = await this.db.client.select({
      id: orgUnits.id, name: orgUnits.name, managerPersonId: orgUnits.managerPersonId,
    }).from(orgUnits).where(and(
      eq(orgUnits.id, unitId), eq(orgUnits.tenantId, tenantId),
      eq(orgUnits.lifecycleStatus, 'active'),
    )).limit(1);
    if (!unit) return [];
    const [team] = teamId ? await this.db.client.select({
      id: orgTeams.id, name: orgTeams.name, teamLeadPersonId: orgTeams.teamLeadPersonId,
    }).from(orgTeams).where(and(
      eq(orgTeams.id, teamId), eq(orgTeams.unitId, unitId),
      eq(orgTeams.tenantId, tenantId), eq(orgTeams.lifecycleStatus, 'active'),
    )).limit(1) : [];
    if (teamId && !team) return [];

    const members = await this.db.client.select({ personId: orgEmployeePlacements.employeePersonId })
      .from(orgEmployeePlacements).where(and(
        eq(orgEmployeePlacements.tenantId, tenantId), eq(orgEmployeePlacements.unitId, unitId),
        eq(orgEmployeePlacements.lifecycleStatus, 'active'),
        team ? eq(orgEmployeePlacements.teamId, team.id) : isNull(orgEmployeePlacements.teamId),
      ));
    const personIds = [...new Set([
      userId, unit.managerPersonId, team?.teamLeadPersonId,
      ...members.map((member) => member.personId),
    ].filter((id): id is string => Boolean(id)))];
    const [persons, accounts] = await Promise.all([
      this.db.client.select({ id: people.id, displayName: people.displayName }).from(people).where(and(
        eq(people.tenantId, tenantId), eq(people.lifecycleStatus, 'active'),
        inArray(people.id, personIds),
      )),
      this.db.client.select({ externalUserId: channelAccounts.externalUserId }).from(channelAccounts).where(and(
        eq(channelAccounts.tenantId, tenantId), eq(channelAccounts.channelType, 'slack'),
        eq(channelAccounts.linkStatus, 'linked'), inArray(channelAccounts.userId, personIds),
      )),
    ]);
    return [...new Set([
      unit.id, unit.name, team?.id, team?.name,
      ...persons.flatMap((member) => [member.id, member.displayName]),
      ...accounts.map((account) => account.externalUserId),
    ].filter((value): value is string => Boolean(value)))];
  }

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
