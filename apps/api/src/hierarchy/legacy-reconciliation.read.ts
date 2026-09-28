import { and, eq, inArray, sql } from 'drizzle-orm';
import { channelAccounts, orgEmployeePlacements, orgTeams, orgUnits, people,
  teamMemberships, teams, tenants, users, type DbClient } from '@entalent/database';
import type { LegacyReconciliationInput } from './legacy-reconciliation';

type Transaction = Parameters<Parameters<DbClient['db']['transaction']>[0]>[0];

export async function readLegacyHierarchyInput(tx: Transaction, tenantId: string): Promise<LegacyReconciliationInput> {
  const [schema] = await tx.execute(sql<{
    peopleReady: boolean; teamsReady: boolean; unitsReady: boolean; placementsReady: boolean;
    linkStatusReady: boolean;
  }>`SELECT to_regclass('people') IS NOT NULL AS "peopleReady",
    to_regclass('org_teams') IS NOT NULL AS "teamsReady",
    to_regclass('org_units') IS NOT NULL AS "unitsReady",
    to_regclass('org_employee_placements') IS NOT NULL AS "placementsReady",
    EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = 'channel_accounts'
        AND column_name = 'link_status') AS "linkStatusReady"`);
  if (!schema) throw new Error('hierarchy_schema_status_unavailable');
  const present = [schema.peopleReady, schema.teamsReady, schema.unitsReady, schema.placementsReady];
  if (present.some(Boolean) && !present.every(Boolean)) {
    throw new Error('hierarchy_schema_partially_applied');
  }
  if (present.every(Boolean) && !schema.linkStatusReady) {
    throw new Error('hierarchy_schema_partially_applied');
  }
  const schemaReady = present.every(Boolean);
  const [tenant] = await tx.select({ id: tenants.id }).from(tenants)
    .where(eq(tenants.id, tenantId)).limit(1);
  if (!tenant) throw new Error('tenant_not_found');
  const legacyTeams = await tx.select({
    id: teams.id, name: teams.name, managerSlackUserId: teams.managerSlackUserId,
  }).from(teams).where(eq(teams.tenantId, tenantId));
  const teamIds = legacyTeams.map((team) => team.id);
  const memberships = teamIds.length === 0 ? [] : await tx.select({
    teamId: teamMemberships.teamId, userId: teamMemberships.userId,
    role: teamMemberships.role, leftAt: teamMemberships.leftAt,
    userTenantId: users.tenantId,
  }).from(teamMemberships).leftJoin(users, eq(teamMemberships.userId, users.id))
    .where(inArray(teamMemberships.teamId, teamIds));
  const accountRows = await tx.select({ userId: channelAccounts.userId, externalWorkspaceId: channelAccounts.externalWorkspaceId,
      externalUserId: channelAccounts.externalUserId,
      linkStatus: schema.linkStatusReady ? channelAccounts.linkStatus : sql<string>`'linked'` })
      .from(channelAccounts).where(and(eq(channelAccounts.tenantId, tenantId),
        eq(channelAccounts.channelType, 'slack')));
  const [personRows, orgTeamRows, orgUnitRows, placementRows] = schemaReady ? await Promise.all([
    tx.select({ id: people.id, primaryRole: people.primaryRole,
      lifecycleStatus: people.lifecycleStatus }).from(people).where(eq(people.tenantId, tenantId)),
    tx.select({ id: orgTeams.id, customerTeamKey: orgTeams.customerTeamKey,
      unitId: orgTeams.unitId, name: orgTeams.name, teamLeadPersonId: orgTeams.teamLeadPersonId,
      lifecycleStatus: orgTeams.lifecycleStatus })
      .from(orgTeams).where(eq(orgTeams.tenantId, tenantId)),
    tx.select({ id: orgUnits.id, customerUnitKey: orgUnits.customerUnitKey,
      name: orgUnits.name, managerPersonId: orgUnits.managerPersonId,
      lifecycleStatus: orgUnits.lifecycleStatus })
      .from(orgUnits).where(eq(orgUnits.tenantId, tenantId)),
    tx.select({ employeePersonId: orgEmployeePlacements.employeePersonId,
      teamId: orgEmployeePlacements.teamId, unitId: orgEmployeePlacements.unitId,
      lifecycleStatus: orgEmployeePlacements.lifecycleStatus })
      .from(orgEmployeePlacements).where(eq(orgEmployeePlacements.tenantId, tenantId)),
  ]) : [[], [], [], []];
  return { tenantId, schemaReady, legacyTeams, memberships, people: personRows,
    slackAccounts: accountRows, orgTeams: orgTeamRows,
    orgUnits: orgUnitRows, placements: placementRows };
}
