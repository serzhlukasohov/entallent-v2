import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import {
  channelAccounts, orgAdvisorAssignments, orgEmployeePlacements, orgHrbpScopes, orgOnboardingDeliveries,
  orgPersonCapabilities, orgTeams, orgUnits, people, workspaceConnections,
} from '@entalent/database';
import { DatabaseService } from '../database/database.service';

@Injectable()
export class CompanySetupReadService {
  constructor(private readonly db: DatabaseService) {}

  async snapshot(tenantId: string) {
    const [persons, units, teams, placements, capabilities, slackLinks, workspaces, deliveries, advisorAssignments, hrbpScopes] = await Promise.all([
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
    ]);
    return { persons, units, teams, placements, capabilities, slackLinks, workspaces, deliveries, advisorAssignments, hrbpScopes };
  }
}
