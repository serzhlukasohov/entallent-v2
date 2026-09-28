import { createHash } from 'node:crypto';

export interface LegacyReconciliationInput {
  tenantId: string;
  schemaReady?: boolean;
  legacyTeams: Array<{ id: string; name: string; managerSlackUserId: string | null }>;
  memberships: Array<{ teamId: string; userId: string; role: string; leftAt: Date | null;
    userTenantId: string | null }>;
  people: Array<{ id: string; primaryRole: string; lifecycleStatus: string }>;
  slackAccounts: Array<{ userId: string; externalWorkspaceId: string; externalUserId: string;
    linkStatus: string }>;
  orgTeams: Array<{ id: string; customerTeamKey: string; unitId: string; lifecycleStatus: string;
    name?: string; teamLeadPersonId?: string | null }>;
  orgUnits: Array<{ id: string; customerUnitKey: string; lifecycleStatus: string;
    name?: string; managerPersonId?: string | null }>;
  placements: Array<{ employeePersonId: string; teamId: string | null; lifecycleStatus: string;
    unitId?: string }>;
}

export interface LegacyTeamReconciliation {
  legacyTeamId: string;
  legacyTeamName: string;
  activeMemberUserIds: string[];
  managerCandidates: Array<{ personId: string; workspaceId: string; role: string | null }>;
  mappedOrgTeamId: string | null;
  mappedOrgUnitKey: string | null;
  issues: string[];
}

export interface LegacyReconciliationReport {
  tenantId: string;
  generatedAt: string;
  readOnly: true;
  schemaReady: boolean;
  sourceFingerprint: string;
  counts: { legacyTeams: number; activeMemberships: number; orgTeams: number; orgUnits: number;
    teamsWithLegacyMarker: number;
    teamsRequiringReview: number };
  teams: LegacyTeamReconciliation[];
  requiredDecisions: string[];
}

/** Inventory only: legacy Team data cannot prove a new Unit or Team Lead. */
export function reconcileLegacyHierarchy(
  input: LegacyReconciliationInput, generatedAt = new Date().toISOString(),
): LegacyReconciliationReport {
  const people = new Map(input.people.map((person) => [person.id, person]));
  const orgTeams = new Map(input.orgTeams.map((team) => [team.customerTeamKey, team]));
  const orgUnits = new Map(input.orgUnits.map((unit) => [unit.id, unit]));
  const activeMemberships = input.memberships.filter((row) => row.leftAt === null);
  const teams = input.legacyTeams.map((team): LegacyTeamReconciliation => {
    const rows = activeMemberships.filter((row) => row.teamId === team.id);
    const memberRows = rows.filter((row) => row.role === 'member');
    const memberIds = [...new Set(memberRows.map((row) => row.userId))].sort();
    const issues = new Set<string>();
    if (rows.some((row) => row.role !== 'member')) issues.add('legacy_non_member_role_requires_review');
    if (rows.some((row) => row.userTenantId !== input.tenantId)) issues.add('membership_cross_tenant_or_missing_user');
    if (memberIds.length !== memberRows.length) issues.add('duplicate_active_membership');
    if (memberIds.length === 0) issues.add('legacy_team_without_active_member');
    if (memberIds.some((id) => !people.has(id))) issues.add('member_person_not_provisioned');
    if (memberIds.some((id) => {
      const person = people.get(id);
      return person && (person.primaryRole !== 'employee' || person.lifecycleStatus === 'inactive');
    })) issues.add('member_person_role_or_lifecycle_mismatch');

    const candidates = team.managerSlackUserId
      ? input.slackAccounts.filter((account) => account.externalUserId === team.managerSlackUserId &&
        account.linkStatus === 'linked')
      : [];
    const managerCandidates = candidates.map((account) => ({
      personId: account.userId, workspaceId: account.externalWorkspaceId,
      role: people.get(account.userId)?.primaryRole ?? null,
    })).sort((a, b) => a.workspaceId.localeCompare(b.workspaceId));
    if (!team.managerSlackUserId) issues.add('manager_slack_id_missing');
    else if (candidates.length === 0) issues.add('manager_slack_id_unmatched');
    else if (candidates.length > 1) issues.add('manager_slack_id_ambiguous');
    else if (!people.has(candidates[0]!.userId)) issues.add('manager_person_not_provisioned');
    else if (people.get(candidates[0]!.userId)?.primaryRole !== 'manager') {
      issues.add('manager_person_role_mismatch');
    }

    const mapped = orgTeams.get(`legacy:${team.id}`);
    if (!mapped) issues.add('team_mapping_marker_missing');
    else {
      const mappedMemberIds = new Set(input.placements.filter((row) => row.teamId === mapped.id &&
        row.lifecycleStatus !== 'inactive').map((row) => row.employeePersonId));
      if (memberIds.some((id) => !mappedMemberIds.has(id)) ||
          [...mappedMemberIds].some((id) => !memberIds.includes(id))) {
        issues.add('mapped_membership_count_or_identity_mismatch');
      }
    }
    issues.add('unit_manager_and_team_lead_confirmation_required');
    return {
      legacyTeamId: team.id, legacyTeamName: team.name,
      activeMemberUserIds: memberIds, managerCandidates,
      mappedOrgTeamId: mapped?.id ?? null,
      mappedOrgUnitKey: mapped ? orgUnits.get(mapped.unitId)?.customerUnitKey ?? null : null,
      issues: [...issues].sort(),
    };
  }).sort((a, b) => a.legacyTeamId.localeCompare(b.legacyTeamId));

  return {
    tenantId: input.tenantId, generatedAt, readOnly: true,
    schemaReady: input.schemaReady ?? true,
    sourceFingerprint: legacySourceFingerprint(input),
    counts: {
      legacyTeams: teams.length,
      activeMemberships: activeMemberships.length,
      orgTeams: input.orgTeams.length, orgUnits: input.orgUnits.length,
      teamsWithLegacyMarker: teams.filter((team) => team.mappedOrgTeamId !== null).length,
      teamsRequiringReview: teams.filter((team) => team.issues.length > 0).length,
    },
    teams,
    requiredDecisions: [
      'Approve each legacy Team to customerTeamKey and Unit mapping.',
      'Confirm the Unit Manager and Team Lead as distinct Person IDs.',
      'Resolve unprovisioned or mismatched member Persons before backfill.',
    ],
  };
}

/** Stable source proof: changes to legacy Team ownership or active membership invalidate a reviewed mapping. */
export function legacySourceFingerprint(input: LegacyReconciliationInput): string {
  const source = {
    tenantId: input.tenantId,
    teams: input.legacyTeams.map((team) => ({ id: team.id, name: team.name,
      managerSlackUserId: team.managerSlackUserId })).sort((a, b) => a.id.localeCompare(b.id)),
    memberships: input.memberships.filter((row) => row.leftAt === null).map((row) => ({
      teamId: row.teamId, userId: row.userId, role: row.role, userTenantId: row.userTenantId,
    })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
  };
  return createHash('sha256').update(JSON.stringify(source)).digest('hex');
}
