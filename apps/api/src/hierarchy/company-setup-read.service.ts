import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import {
  channelAccounts, orgAdvisorAssignments, orgEmployeePlacements, orgHrbpScopes, orgOnboardingDeliveries,
  onboardingStates, orgPersonCapabilities, orgTeams, orgUnits, people, tenantWorkCalendars, workspaceConnections,
} from '@entalent/database';
import { DatabaseService } from '../database/database.service';

export const ONBOARDING_MIN_GROUP = 5;
export type OnboardingUnitSummary = { unitId: string; delivered: number; completed: number; inProgress: number } | { unitId: string; suppressed: true };

/**
 * Q20/A5: aggregate-only. Each person counts in at most one active unit (Employee by placement, Team Lead by
 * their active team's unit, Manager by the unit they manage). Declined/deferred are folded into inProgress.
 */
export function summarizeOnboarding(
  units: Array<{ id: string; managerPersonId: string | null; lifecycleStatus: string }>,
  teams: Array<{ unitId: string; teamLeadPersonId: string | null; lifecycleStatus: string }>,
  placements: Array<{ employeePersonId: string; unitId: string; lifecycleStatus: string }>,
  states: Array<{ personId: string; introStatus: string }>,
): OnboardingUnitSummary[] {
  const active = units.filter((unit) => unit.lifecycleStatus === 'active');
  const activeIds = new Set(active.map((unit) => unit.id));
  const home = new Map<string, string>();
  for (const unit of active) if (unit.managerPersonId) home.set(unit.managerPersonId, unit.id);
  for (const team of teams) {
    if (team.lifecycleStatus === 'active' && team.teamLeadPersonId && activeIds.has(team.unitId) && !home.has(team.teamLeadPersonId)) home.set(team.teamLeadPersonId, team.unitId);
  }
  for (const placement of placements) {
    if (placement.lifecycleStatus === 'active' && activeIds.has(placement.unitId) && !home.has(placement.employeePersonId)) home.set(placement.employeePersonId, placement.unitId);
  }
  const groups = new Map<string, { size: number; delivered: number; completed: number }>();
  for (const state of states) {
    const unitId = home.get(state.personId);
    if (!unitId) continue;
    const group = groups.get(unitId) ?? { size: 0, delivered: 0, completed: 0 };
    group.size += 1;
    if (state.introStatus === 'delivered' || state.introStatus === 'completed') group.delivered += 1;
    if (state.introStatus === 'completed') group.completed += 1;
    groups.set(unitId, group);
  }
  return active.map((unit) => {
    const group = groups.get(unit.id) ?? { size: 0, delivered: 0, completed: 0 };
    if (group.size < ONBOARDING_MIN_GROUP) return { unitId: unit.id, suppressed: true as const };
    return { unitId: unit.id, delivered: group.delivered, completed: group.completed, inProgress: group.delivered - group.completed };
  });
}

@Injectable()
export class CompanySetupReadService {
  constructor(private readonly db: DatabaseService) {}

  async snapshot(tenantId: string) {
    const [persons, units, teams, placements, capabilities, slackLinks, workspaces, deliveries, advisorAssignments, hrbpScopes, calendars, onboarding] = await Promise.all([
      this.db.client.select({
        id: people.id, customerEmployeeId: people.customerEmployeeId,
        workEmail: people.workEmail, displayName: people.displayName,
        jobTitle: people.jobTitle, primaryRole: people.primaryRole,
        pulseParticipant: people.pulseParticipant, lifecycleStatus: people.lifecycleStatus,
      }).from(people).where(eq(people.tenantId, tenantId)),
      this.db.client.select().from(orgUnits).where(eq(orgUnits.tenantId, tenantId)),
      this.db.client.select().from(orgTeams).where(eq(orgTeams.tenantId, tenantId)),
      this.db.client.select().from(orgEmployeePlacements).where(eq(orgEmployeePlacements.tenantId, tenantId)),
      this.db.client.select().from(orgPersonCapabilities).where(eq(orgPersonCapabilities.tenantId, tenantId)),
      this.db.client.select({
        userId: channelAccounts.userId, externalWorkspaceId: channelAccounts.externalWorkspaceId,
        externalUserId: channelAccounts.externalUserId,
      }).from(channelAccounts).where(and(eq(channelAccounts.tenantId, tenantId),
        eq(channelAccounts.channelType, 'slack'), eq(channelAccounts.linkStatus, 'linked'))),
      this.db.client.select({
        channelType: workspaceConnections.channelType,
        externalWorkspaceId: workspaceConnections.externalWorkspaceId,
        status: workspaceConnections.status,
        scopes: workspaceConnections.scopes,
      }).from(workspaceConnections).where(eq(workspaceConnections.tenantId, tenantId)),
      this.db.client.select({
        personId: orgOnboardingDeliveries.personId, unitId: orgOnboardingDeliveries.unitId,
        status: orgOnboardingDeliveries.status, attemptCount: orgOnboardingDeliveries.attemptCount,
        lastAttemptAt: orgOnboardingDeliveries.lastAttemptAt,
        deliveredAt: orgOnboardingDeliveries.deliveredAt,
      }).from(orgOnboardingDeliveries).where(eq(orgOnboardingDeliveries.tenantId, tenantId)),
      this.db.client.select().from(orgAdvisorAssignments).where(eq(orgAdvisorAssignments.tenantId, tenantId)),
      this.db.client.select().from(orgHrbpScopes).where(eq(orgHrbpScopes.tenantId, tenantId)),
      this.db.client.select({
        timezone: tenantWorkCalendars.timezone, workingDays: tenantWorkCalendars.workingDays,
        workStart: tenantWorkCalendars.workStart, workEnd: tenantWorkCalendars.workEnd,
      }).from(tenantWorkCalendars).where(eq(tenantWorkCalendars.tenantId, tenantId)),
      this.db.client.select({ personId: onboardingStates.personId, introStatus: onboardingStates.introStatus })
        .from(onboardingStates).where(eq(onboardingStates.tenantId, tenantId)),
    ]);
    const onboardingSummary = summarizeOnboarding(units, teams, placements, onboarding);
    // Read-only: only enTalent staff configure the calendar (Q17); absence blocks rollout (Q18).
    const calendar = calendars[0] ?? null;
    return { persons, units, teams, placements, capabilities, slackLinks, workspaces, deliveries, advisorAssignments, hrbpScopes,
      calendarConfigured: calendar !== null, calendar, onboardingSummary };
  }
}
