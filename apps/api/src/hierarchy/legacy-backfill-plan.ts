import { legacySourceFingerprint, type LegacyReconciliationInput } from './legacy-reconciliation';

export interface LegacyBackfillMapping {
  legacyTeamId: string;
  customerTeamKey: string;
  teamName: string;
  customerUnitKey: string;
  unitName: string;
  managerPersonId: string;
  teamLeadPersonId: string;
  memberPersonIds: string[];
}

export interface LegacyBackfillManifest {
  schemaVersion: 1;
  tenantId: string;
  sourceFingerprint: string;
  teams: LegacyBackfillMapping[];
  quarantinedTeams?: Array<{ legacyTeamId: string; reason: 'test_fixture' | 'outside_customer_scope' }>;
}

export interface LegacyBackfillPlan {
  tenantId: string;
  sourceFingerprint: string;
  units: Array<{ customerUnitKey: string; name: string; managerPersonId: string; existingId: string | null }>;
  teams: Array<{ legacyTeamId: string; customerTeamKey: string; name: string;
    customerUnitKey: string; teamLeadPersonId: string; memberPersonIds: string[];
    existingId: string | null; newPlacementPersonIds: string[] }>;
  quarantinedTeams: Array<{ legacyTeamId: string; reason: 'test_fixture' | 'outside_customer_scope' }>;
  counts: { newUnits: number; newTeams: number; newPlacements: number };
}

export class LegacyBackfillValidationError extends Error {
  constructor(readonly issues: string[]) {
    super(`Legacy backfill mapping rejected: ${issues.join(', ')}`);
    this.name = 'LegacyBackfillValidationError';
  }
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new LegacyBackfillValidationError(['manifest_invalid_object']);
  }
  return value as Record<string, unknown>;
}

function nonempty(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 500) {
    throw new LegacyBackfillValidationError([`${field}_invalid`]);
  }
  return value.trim();
}

export function parseLegacyBackfillManifest(value: unknown): LegacyBackfillManifest {
  const raw = record(value);
  if (raw['schemaVersion'] !== 1) throw new LegacyBackfillValidationError(['schema_version_invalid']);
  if (!Array.isArray(raw['teams'])) throw new LegacyBackfillValidationError(['teams_invalid']);
  if (raw['quarantinedTeams'] !== undefined && !Array.isArray(raw['quarantinedTeams'])) {
    throw new LegacyBackfillValidationError(['quarantined_teams_invalid']);
  }
  const teams = raw['teams'].map((entry: unknown, index: number) => {
    const row = record(entry);
    if (!Array.isArray(row['memberPersonIds']) || row['memberPersonIds'].some((id) =>
      typeof id !== 'string' || !id.trim())) {
      throw new LegacyBackfillValidationError([`teams_${index}_members_invalid`]);
    }
    return {
      legacyTeamId: nonempty(row['legacyTeamId'], `teams_${index}_legacy_team_id`),
      customerTeamKey: nonempty(row['customerTeamKey'], `teams_${index}_customer_team_key`),
      teamName: nonempty(row['teamName'], `teams_${index}_team_name`),
      customerUnitKey: nonempty(row['customerUnitKey'], `teams_${index}_customer_unit_key`),
      unitName: nonempty(row['unitName'], `teams_${index}_unit_name`),
      managerPersonId: nonempty(row['managerPersonId'], `teams_${index}_manager_person_id`),
      teamLeadPersonId: nonempty(row['teamLeadPersonId'], `teams_${index}_team_lead_person_id`),
      memberPersonIds: row['memberPersonIds'].map((id: string) => id.trim()),
    };
  });
  const sourceFingerprint = nonempty(raw['sourceFingerprint'], 'source_fingerprint');
  if (!/^[0-9a-f]{64}$/i.test(sourceFingerprint)) {
    throw new LegacyBackfillValidationError(['source_fingerprint_invalid']);
  }
  const quarantinedTeams = ((raw['quarantinedTeams'] ?? []) as unknown[]).map((entry, index) => {
    const row = record(entry);
    const reason = row['reason'];
    if (reason !== 'test_fixture' && reason !== 'outside_customer_scope') {
      throw new LegacyBackfillValidationError([`quarantined_teams_${index}_reason_invalid`]);
    }
    return { legacyTeamId: nonempty(row['legacyTeamId'], `quarantined_teams_${index}_legacy_team_id`),
      reason: reason as 'test_fixture' | 'outside_customer_scope' };
  });
  return { schemaVersion: 1, tenantId: nonempty(raw['tenantId'], 'tenant_id'),
    sourceFingerprint: sourceFingerprint.toLowerCase(), teams, quarantinedTeams };
}

/** Validates an approved mapping against one consistent live database snapshot. */
export function planLegacyDraftBackfill(
  input: LegacyReconciliationInput, manifest: LegacyBackfillManifest,
): LegacyBackfillPlan {
  const issues: string[] = [];
  if (manifest.tenantId !== input.tenantId) issues.push('tenant_mismatch');
  const sourceFingerprint = legacySourceFingerprint(input);
  if (manifest.sourceFingerprint !== sourceFingerprint) issues.push('source_fingerprint_mismatch');

  const legacyById = new Map(input.legacyTeams.map((row) => [row.id, row]));
  const peopleById = new Map(input.people.map((row) => [row.id, row]));
  const unitsByKey = new Map(input.orgUnits.map((row) => [row.customerUnitKey, row]));
  const teamsByKey = new Map(input.orgTeams.map((row) => [row.customerTeamKey, row]));
  const mappedLegacy = new Set<string>();
  const mappedTeamKeys = new Set<string>();
  const mappedLeadIds = new Set<string>();
  const mappedEmployeeIds = new Set<string>();
  const managerUnitKeys = new Map<string, string>();
  const desiredUnits = new Map<string, { name: string; managerPersonId: string }>();
  const teamPlans: LegacyBackfillPlan['teams'] = [];

  for (const row of manifest.teams) {
    if (mappedLegacy.has(row.legacyTeamId)) issues.push(`duplicate_legacy_team:${row.legacyTeamId}`);
    mappedLegacy.add(row.legacyTeamId);
    if (mappedTeamKeys.has(row.customerTeamKey)) issues.push(`duplicate_customer_team_key:${row.customerTeamKey}`);
    mappedTeamKeys.add(row.customerTeamKey);
    const legacy = legacyById.get(row.legacyTeamId);
    if (!legacy) { issues.push(`unknown_legacy_team:${row.legacyTeamId}`); continue; }
    if (row.managerPersonId === row.teamLeadPersonId) issues.push(`owner_roles_not_distinct:${row.legacyTeamId}`);
    const manager = peopleById.get(row.managerPersonId);
    if (!manager || manager.primaryRole !== 'manager' || manager.lifecycleStatus === 'inactive') {
      issues.push(`invalid_manager:${row.legacyTeamId}`);
    }
    const lead = peopleById.get(row.teamLeadPersonId);
    if (!lead || lead.primaryRole !== 'team_lead' || lead.lifecycleStatus === 'inactive') {
      issues.push(`invalid_team_lead:${row.legacyTeamId}`);
    }
    if (mappedLeadIds.has(row.teamLeadPersonId)) issues.push(`team_lead_owns_multiple_teams:${row.teamLeadPersonId}`);
    mappedLeadIds.add(row.teamLeadPersonId);
    const previousUnit = managerUnitKeys.get(row.managerPersonId);
    if (previousUnit && previousUnit !== row.customerUnitKey) issues.push(`manager_owns_multiple_units:${row.managerPersonId}`);
    managerUnitKeys.set(row.managerPersonId, row.customerUnitKey);
    if (input.orgUnits.some((unit) => unit.managerPersonId === row.managerPersonId &&
      unit.customerUnitKey !== row.customerUnitKey && unit.lifecycleStatus !== 'inactive')) {
      issues.push(`manager_already_owns_other_unit:${row.managerPersonId}`);
    }
    if (input.orgTeams.some((team) => team.teamLeadPersonId === row.teamLeadPersonId &&
      team.customerTeamKey !== row.customerTeamKey && team.lifecycleStatus !== 'inactive')) {
      issues.push(`lead_already_owns_other_team:${row.teamLeadPersonId}`);
    }
    const desiredUnit = desiredUnits.get(row.customerUnitKey);
    if (desiredUnit && (desiredUnit.name !== row.unitName || desiredUnit.managerPersonId !== row.managerPersonId)) {
      issues.push(`unit_definition_conflict:${row.customerUnitKey}`);
    } else desiredUnits.set(row.customerUnitKey, { name: row.unitName, managerPersonId: row.managerPersonId });

    const legacyRows = input.memberships.filter((member) => member.teamId === row.legacyTeamId &&
      member.leftAt === null);
    if (legacyRows.some((member) => member.role !== 'member' || member.userTenantId !== input.tenantId)) {
      issues.push(`legacy_membership_unresolved:${row.legacyTeamId}`);
    }
    const sourceMembers = legacyRows.filter((member) => member.role === 'member').map((member) => member.userId).sort();
    const requestedMembers = [...row.memberPersonIds].sort();
    if (sourceMembers.length !== requestedMembers.length ||
      sourceMembers.some((id, index) => id !== requestedMembers[index])) {
      issues.push(`membership_mismatch:${row.legacyTeamId}`);
    }
    if (row.memberPersonIds.length === 0) issues.push(`empty_team:${row.legacyTeamId}`);
    for (const memberId of row.memberPersonIds) {
      const person = peopleById.get(memberId);
      if (!person || person.primaryRole !== 'employee' || person.lifecycleStatus === 'inactive') {
        issues.push(`invalid_employee:${memberId}`);
      }
      if (mappedEmployeeIds.has(memberId)) issues.push(`employee_in_multiple_teams:${memberId}`);
      mappedEmployeeIds.add(memberId);
    }
    const existingUnit = unitsByKey.get(row.customerUnitKey);
    if (existingUnit && (existingUnit.lifecycleStatus !== 'draft' ||
      existingUnit.name !== row.unitName || existingUnit.managerPersonId !== row.managerPersonId)) {
      issues.push(`existing_unit_conflict:${row.customerUnitKey}`);
    }
    const marker = teamsByKey.get(`legacy:${row.legacyTeamId}`);
    if (marker && marker.customerTeamKey !== row.customerTeamKey) {
      issues.push(`legacy_marker_conflict:${row.legacyTeamId}`);
    }
    const existingTeam = teamsByKey.get(row.customerTeamKey);
    if (existingTeam && (existingTeam.lifecycleStatus !== 'draft' ||
      existingTeam.name !== row.teamName || existingTeam.teamLeadPersonId !== row.teamLeadPersonId ||
      !existingUnit || existingTeam.unitId !== existingUnit.id)) {
      issues.push(`existing_team_conflict:${row.customerTeamKey}`);
    }
    const newPlacementPersonIds: string[] = [];
    for (const memberId of row.memberPersonIds) {
      const placements = input.placements.filter((placement) => placement.employeePersonId === memberId &&
        placement.lifecycleStatus !== 'inactive');
      if (placements.length === 0) newPlacementPersonIds.push(memberId);
      else if (placements.length !== 1 || !existingTeam || !existingUnit ||
        placements[0]?.teamId !== existingTeam.id || placements[0]?.unitId !== existingUnit.id ||
        placements[0]?.lifecycleStatus !== 'draft') {
        issues.push(`existing_placement_conflict:${memberId}`);
      }
    }
    teamPlans.push({ legacyTeamId: row.legacyTeamId, customerTeamKey: row.customerTeamKey,
      name: row.teamName, customerUnitKey: row.customerUnitKey,
      teamLeadPersonId: row.teamLeadPersonId, memberPersonIds: [...row.memberPersonIds].sort(),
      existingId: existingTeam?.id ?? null, newPlacementPersonIds });
  }
  const quarantinedTeams = [...(manifest.quarantinedTeams ?? [])].sort((a, b) =>
    a.legacyTeamId.localeCompare(b.legacyTeamId));
  for (const row of quarantinedTeams) {
    if (mappedLegacy.has(row.legacyTeamId)) issues.push(`duplicate_legacy_team:${row.legacyTeamId}`);
    mappedLegacy.add(row.legacyTeamId);
    if (!legacyById.has(row.legacyTeamId)) issues.push(`unknown_legacy_team:${row.legacyTeamId}`);
  }
  for (const legacy of input.legacyTeams) {
    if (!mappedLegacy.has(legacy.id)) issues.push(`unmapped_legacy_team:${legacy.id}`);
  }
  if (issues.length) throw new LegacyBackfillValidationError([...new Set(issues)].sort());

  const units = [...desiredUnits].map(([customerUnitKey, desired]) => ({ customerUnitKey,
    name: desired.name, managerPersonId: desired.managerPersonId,
    existingId: unitsByKey.get(customerUnitKey)?.id ?? null })).sort((a, b) => a.customerUnitKey.localeCompare(b.customerUnitKey));
  const teams = teamPlans.sort((a, b) => a.legacyTeamId.localeCompare(b.legacyTeamId));
  return { tenantId: input.tenantId, sourceFingerprint, units, teams, quarantinedTeams,
    counts: { newUnits: units.filter((unit) => !unit.existingId).length,
      newTeams: teams.filter((team) => !team.existingId).length,
      newPlacements: teams.reduce((sum, team) => sum + team.newPlacementPersonIds.length, 0) } };
}
