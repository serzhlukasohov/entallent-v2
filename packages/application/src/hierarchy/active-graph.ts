import type { PrimaryOrgRole } from './draft-person';

export interface ActiveGraphPerson {
  id: string;
  tenantId: string;
  primaryRole: PrimaryOrgRole;
  lifecycleStatus: string;
}

export interface ActiveGraphUnit {
  id: string;
  tenantId: string;
  managerPersonId: string | null;
  lifecycleStatus: string;
}

export interface ActiveGraphTeam {
  id: string;
  tenantId: string;
  unitId: string;
  teamLeadPersonId: string | null;
  lifecycleStatus: string;
}

export interface ActiveGraphPlacement {
  id: string;
  tenantId: string;
  employeePersonId: string;
  unitId: string;
  teamId: string | null;
  lifecycleStatus: string;
}

export interface ActiveHierarchyGraph {
  tenantId: string;
  people: ActiveGraphPerson[];
  units: ActiveGraphUnit[];
  teams: ActiveGraphTeam[];
  placements: ActiveGraphPlacement[];
}

export interface ActiveGraphIssue {
  code: string;
  entityId: string;
}

/** Validates the complete active subgraph after a proposed typed mutation. */
export function validateActiveHierarchy(graph: ActiveHierarchyGraph): ActiveGraphIssue[] {
  const issues: ActiveGraphIssue[] = [];
  const active = (status: string) => status === 'active';
  const people = new Map(graph.people.filter((p) => active(p.lifecycleStatus) && p.tenantId === graph.tenantId)
    .map((p) => [p.id, p]));
  const units = new Map(graph.units.filter((u) => active(u.lifecycleStatus) && u.tenantId === graph.tenantId)
    .map((u) => [u.id, u]));
  const teams = new Map(graph.teams.filter((t) => active(t.lifecycleStatus) && t.tenantId === graph.tenantId)
    .map((t) => [t.id, t]));
  const ownership = new Map<string, number>();
  const placements = new Map<string, number>();
  const teamEmployees = new Map<string, number>();
  const unitSubordinates = new Map<string, number>();
  const count = (map: Map<string, number>, id: string) => map.set(id, (map.get(id) ?? 0) + 1);

  for (const unit of graph.units.filter((u) => active(u.lifecycleStatus))) {
    if (unit.tenantId !== graph.tenantId) {
      issues.push({ code: 'cross_tenant_unit', entityId: unit.id });
      continue;
    }
    const manager = unit.managerPersonId && people.get(unit.managerPersonId);
    if (!manager || manager.primaryRole !== 'manager') issues.push({ code: 'active_unit_without_manager', entityId: unit.id });
    else count(ownership, manager.id);
  }

  for (const team of graph.teams.filter((t) => active(t.lifecycleStatus))) {
    if (team.tenantId !== graph.tenantId || !units.has(team.unitId)) {
      issues.push({ code: 'active_team_without_unit', entityId: team.id });
      continue;
    }
    const lead = team.teamLeadPersonId && people.get(team.teamLeadPersonId);
    if (!lead || lead.primaryRole !== 'team_lead') {
      issues.push({ code: 'active_team_without_lead', entityId: team.id });
    } else {
      count(ownership, lead.id);
      count(unitSubordinates, team.unitId);
    }
  }

  for (const placement of graph.placements.filter((p) => active(p.lifecycleStatus))) {
    if (placement.tenantId !== graph.tenantId || !units.has(placement.unitId)) {
      issues.push({ code: 'active_placement_without_unit', entityId: placement.id });
      continue;
    }
    const employee = people.get(placement.employeePersonId);
    if (!employee || employee.primaryRole !== 'employee') {
      issues.push({ code: 'active_placement_without_employee', entityId: placement.id });
      continue;
    }
    count(placements, employee.id);
    count(unitSubordinates, placement.unitId);
    if (placement.teamId) {
      const team = teams.get(placement.teamId);
      if (!team || team.unitId !== placement.unitId) {
        issues.push({ code: 'active_placement_invalid_team', entityId: placement.id });
      } else count(teamEmployees, team.id);
    }
  }

  for (const team of teams.values()) {
    if ((teamEmployees.get(team.id) ?? 0) < 1) issues.push({ code: 'active_team_without_employee', entityId: team.id });
  }
  for (const unit of units.values()) {
    if ((unitSubordinates.get(unit.id) ?? 0) < 1) issues.push({ code: 'active_unit_without_subordinate', entityId: unit.id });
  }
  for (const person of people.values()) {
    const actual = person.primaryRole === 'employee' ? placements.get(person.id)
      : person.primaryRole === 'manager' || person.primaryRole === 'team_lead' ? ownership.get(person.id)
        : undefined;
    if (actual !== undefined && actual !== 1) issues.push({ code: 'active_person_multiple_homes', entityId: person.id });
    if (actual === undefined && ['employee', 'manager', 'team_lead'].includes(person.primaryRole)) {
      issues.push({ code: 'active_person_without_home', entityId: person.id });
    }
  }
  return issues;
}

export type EmployeeMovePlan =
  | { ok: true; placementId: string; before: { unitId: string; teamId: string | null };
      after: { unitId: string; teamId: string | null } }
  | { ok: false; issues: ActiveGraphIssue[] };

export function planEmployeeMove(
  graph: ActiveHierarchyGraph, employeePersonId: string, targetUnitId: string, targetTeamId: string | null,
): EmployeeMovePlan {
  const current = graph.placements.filter((p) => p.employeePersonId === employeePersonId &&
    p.tenantId === graph.tenantId && p.lifecycleStatus === 'active');
  if (current.length !== 1) return { ok: false, issues: [{ code: 'employee_active_placement_required', entityId: employeePersonId }] };
  const person = graph.people.find((p) => p.id === employeePersonId && p.tenantId === graph.tenantId &&
    p.lifecycleStatus === 'active' && p.primaryRole === 'employee');
  if (!person) return { ok: false, issues: [{ code: 'active_employee_required', entityId: employeePersonId }] };
  const unit = graph.units.find((u) => u.id === targetUnitId && u.tenantId === graph.tenantId && u.lifecycleStatus === 'active');
  if (!unit) return { ok: false, issues: [{ code: 'active_target_unit_required', entityId: targetUnitId }] };
  if (targetTeamId) {
    const team = graph.teams.find((t) => t.id === targetTeamId && t.tenantId === graph.tenantId &&
      t.unitId === targetUnitId && t.lifecycleStatus === 'active');
    if (!team) return { ok: false, issues: [{ code: 'active_target_team_required', entityId: targetTeamId }] };
  }
  const placement = current[0]!;
  if (placement.unitId === targetUnitId && placement.teamId === targetTeamId) {
    return { ok: false, issues: [{ code: 'employee_already_placed_here', entityId: employeePersonId }] };
  }
  const after = { unitId: targetUnitId, teamId: targetTeamId };
  const proposed = {
    ...graph,
    placements: graph.placements.map((p) => p.id === placement.id ? { ...p, ...after } : p),
  };
  const issues = validateActiveHierarchy(proposed);
  return issues.length > 0 ? { ok: false, issues } : {
    ok: true, placementId: placement.id,
    before: { unitId: placement.unitId, teamId: placement.teamId }, after,
  };
}

export type EmployeeDeactivationPlan =
  | { ok: true; placementIds: string[] }
  | { ok: false; issues: ActiveGraphIssue[] };

export function planEmployeeDeactivation(
  graph: ActiveHierarchyGraph, employeePersonId: string,
): EmployeeDeactivationPlan {
  const person = graph.people.find((row) => row.id === employeePersonId &&
    row.tenantId === graph.tenantId && row.lifecycleStatus === 'active' && row.primaryRole === 'employee');
  if (!person) return { ok: false, issues: [{ code: 'active_employee_required', entityId: employeePersonId }] };
  const placementIds = graph.placements.filter((row) => row.employeePersonId === employeePersonId &&
    row.tenantId === graph.tenantId && row.lifecycleStatus === 'active').map((row) => row.id);
  if (placementIds.length !== 1) return { ok: false, issues: [
    { code: 'employee_active_placement_required', entityId: employeePersonId },
  ] };
  const proposed: ActiveHierarchyGraph = {
    ...graph,
    people: graph.people.map((row) => row.id === employeePersonId
      ? { ...row, lifecycleStatus: 'inactive' } : row),
    placements: graph.placements.map((row) => placementIds.includes(row.id)
      ? { ...row, lifecycleStatus: 'inactive' } : row),
  };
  const issues = validateActiveHierarchy(proposed);
  return issues.length > 0 ? { ok: false, issues } : { ok: true, placementIds };
}

export type PreviousTeamLeadAction = 'become_employee' | 'deactivate';

export type TeamLeadPromotionPlan =
  | { ok: true; teamId: string; unitId: string; newLeadPersonId: string; previousLeadPersonId: string;
      promotedPlacementId: string; previousLeadAction: PreviousTeamLeadAction }
  | { ok: false; issues: ActiveGraphIssue[] };

/** Promotes an active member of the same Team and explicitly handles the previous Lead. */
export function planTeamLeadPromotion(
  graph: ActiveHierarchyGraph, teamId: string, employeePersonId: string,
  previousLeadAction: PreviousTeamLeadAction,
): TeamLeadPromotionPlan {
  if (!['become_employee', 'deactivate'].includes(previousLeadAction)) {
    return { ok: false, issues: [{ code: 'previous_lead_action_required', entityId: teamId }] };
  }
  const team = graph.teams.find((row) => row.id === teamId && row.tenantId === graph.tenantId &&
    row.lifecycleStatus === 'active');
  if (!team || !team.teamLeadPersonId) {
    return { ok: false, issues: [{ code: 'active_team_lead_required', entityId: teamId }] };
  }
  const previousLead = graph.people.find((row) => row.id === team.teamLeadPersonId &&
    row.tenantId === graph.tenantId && row.lifecycleStatus === 'active' && row.primaryRole === 'team_lead');
  const employee = graph.people.find((row) => row.id === employeePersonId &&
    row.tenantId === graph.tenantId && row.lifecycleStatus === 'active' && row.primaryRole === 'employee');
  const placement = graph.placements.find((row) => row.employeePersonId === employeePersonId &&
    row.tenantId === graph.tenantId && row.teamId === teamId && row.unitId === team.unitId &&
    row.lifecycleStatus === 'active');
  if (!previousLead || !employee || !placement) {
    return { ok: false, issues: [{ code: 'same_team_active_employee_required', entityId: employeePersonId }] };
  }
  const proposed: ActiveHierarchyGraph = {
    ...graph,
    people: graph.people.map((person) => person.id === employeePersonId
      ? { ...person, primaryRole: 'team_lead' }
      : person.id === previousLead.id
        ? previousLeadAction === 'become_employee'
          ? { ...person, primaryRole: 'employee' }
          : { ...person, lifecycleStatus: 'inactive' }
        : person),
    teams: graph.teams.map((row) => row.id === teamId
      ? { ...row, teamLeadPersonId: employeePersonId } : row),
    placements: [
      ...graph.placements.map((row) => row.id === placement.id
        ? { ...row, lifecycleStatus: 'inactive' } : row),
      ...previousLeadAction === 'become_employee' ? [{
        id: `new-placement-for-${previousLead.id}`,
        tenantId: graph.tenantId, employeePersonId: previousLead.id,
        unitId: team.unitId, teamId, lifecycleStatus: 'active',
      }] : [],
    ],
  };
  const issues = validateActiveHierarchy(proposed);
  return issues.length > 0 ? { ok: false, issues } : {
    ok: true, teamId, unitId: team.unitId, newLeadPersonId: employeePersonId,
    previousLeadPersonId: previousLead.id, promotedPlacementId: placement.id,
    previousLeadAction,
  };
}

export type PreviousManagerAction = 'become_employee' | 'deactivate';

export type ManagerPromotionPlan =
  | { ok: true; unitId: string; newManagerPersonId: string; previousManagerPersonId: string;
      promotedPlacementId: string; previousManagerAction: PreviousManagerAction }
  | { ok: false; issues: ActiveGraphIssue[] };

/** Promotes an active Employee in the Unit while explicitly handling its previous Manager. */
export function planManagerPromotion(
  graph: ActiveHierarchyGraph, unitId: string, employeePersonId: string,
  previousManagerAction: PreviousManagerAction,
): ManagerPromotionPlan {
  if (!['become_employee', 'deactivate'].includes(previousManagerAction)) {
    return { ok: false, issues: [{ code: 'previous_manager_action_required', entityId: unitId }] };
  }
  const unit = graph.units.find((row) => row.id === unitId && row.tenantId === graph.tenantId &&
    row.lifecycleStatus === 'active');
  if (!unit || !unit.managerPersonId) {
    return { ok: false, issues: [{ code: 'active_unit_manager_required', entityId: unitId }] };
  }
  const previousManager = graph.people.find((row) => row.id === unit.managerPersonId &&
    row.tenantId === graph.tenantId && row.lifecycleStatus === 'active' && row.primaryRole === 'manager');
  const employee = graph.people.find((row) => row.id === employeePersonId &&
    row.tenantId === graph.tenantId && row.lifecycleStatus === 'active' && row.primaryRole === 'employee');
  const placement = graph.placements.find((row) => row.employeePersonId === employeePersonId &&
    row.tenantId === graph.tenantId && row.unitId === unitId && row.lifecycleStatus === 'active');
  if (!previousManager || !employee || !placement) {
    return { ok: false, issues: [{ code: 'same_unit_active_employee_required', entityId: employeePersonId }] };
  }
  const proposed: ActiveHierarchyGraph = {
    ...graph,
    people: graph.people.map((person) => person.id === employeePersonId
      ? { ...person, primaryRole: 'manager' }
      : person.id === previousManager.id
        ? previousManagerAction === 'become_employee'
          ? { ...person, primaryRole: 'employee' }
          : { ...person, lifecycleStatus: 'inactive' }
        : person),
    units: graph.units.map((row) => row.id === unitId
      ? { ...row, managerPersonId: employeePersonId } : row),
    placements: [
      ...graph.placements.map((row) => row.id === placement.id
        ? { ...row, lifecycleStatus: 'inactive' } : row),
      ...previousManagerAction === 'become_employee' ? [{
        id: `new-placement-for-${previousManager.id}`,
        tenantId: graph.tenantId, employeePersonId: previousManager.id,
        unitId, teamId: null, lifecycleStatus: 'active',
      }] : [],
    ],
  };
  const issues = validateActiveHierarchy(proposed);
  return issues.length > 0 ? { ok: false, issues } : {
    ok: true, unitId, newManagerPersonId: employeePersonId,
    previousManagerPersonId: previousManager.id, promotedPlacementId: placement.id,
    previousManagerAction,
  };
}

export type TeamDeactivationPlan =
  | { ok: true; teamId: string; unitId: string; leadPersonId: string;
      placementIds: string[]; leadAction: PreviousTeamLeadAction }
  | { ok: false; issues: ActiveGraphIssue[] };

/** Ends a Team while retaining its Employees as direct Unit members. */
export function planTeamDeactivation(
  graph: ActiveHierarchyGraph, teamId: string, leadAction: PreviousTeamLeadAction,
): TeamDeactivationPlan {
  if (!['become_employee', 'deactivate'].includes(leadAction)) {
    return { ok: false, issues: [{ code: 'previous_lead_action_required', entityId: teamId }] };
  }
  const team = graph.teams.find((row) => row.id === teamId && row.tenantId === graph.tenantId &&
    row.lifecycleStatus === 'active');
  if (!team || !team.teamLeadPersonId) {
    return { ok: false, issues: [{ code: 'active_team_lead_required', entityId: teamId }] };
  }
  const unit = graph.units.find((row) => row.id === team.unitId && row.tenantId === graph.tenantId &&
    row.lifecycleStatus === 'active');
  const lead = graph.people.find((row) => row.id === team.teamLeadPersonId &&
    row.tenantId === graph.tenantId && row.lifecycleStatus === 'active' && row.primaryRole === 'team_lead');
  if (!unit || !lead) {
    return { ok: false, issues: [{ code: 'active_team_structure_required', entityId: teamId }] };
  }
  const affected = graph.placements.filter((row) => row.teamId === teamId &&
    row.tenantId === graph.tenantId && row.lifecycleStatus !== 'inactive');
  const proposed: ActiveHierarchyGraph = {
    ...graph,
    people: graph.people.map((row) => row.id === lead.id
      ? leadAction === 'become_employee'
        ? { ...row, primaryRole: 'employee' }
        : { ...row, lifecycleStatus: 'inactive' }
      : row),
    teams: graph.teams.map((row) => row.id === teamId
      ? { ...row, lifecycleStatus: 'inactive' } : row),
    placements: [
      ...graph.placements.map((row) => row.teamId === teamId && row.tenantId === graph.tenantId &&
        row.lifecycleStatus !== 'inactive' ? { ...row, teamId: null } : row),
      ...leadAction === 'become_employee' ? [{
        id: `new-placement-for-${lead.id}`, tenantId: graph.tenantId,
        employeePersonId: lead.id, unitId: unit.id, teamId: null, lifecycleStatus: 'active',
      }] : [],
    ],
  };
  const issues = validateActiveHierarchy(proposed);
  return issues.length > 0 ? { ok: false, issues } : {
    ok: true, teamId, unitId: unit.id, leadPersonId: lead.id,
    placementIds: affected.map((row) => row.id), leadAction,
  };
}

export type UnitTransferDeactivationPlan =
  | { ok: true; sourceUnitId: string; targetUnitId: string; managerPersonId: string;
      managerAction: PreviousManagerAction; teamIds: string[];
      placements: Array<{ id: string; teamId: string | null }> }
  | { ok: false; issues: ActiveGraphIssue[] };

/** Merges one active Unit into another, retaining Team and Employee identities. */
export function planUnitTransferDeactivation(
  graph: ActiveHierarchyGraph, sourceUnitId: string, targetUnitId: string,
  managerAction: PreviousManagerAction,
): UnitTransferDeactivationPlan {
  if (!['become_employee', 'deactivate'].includes(managerAction)) {
    return { ok: false, issues: [{ code: 'previous_manager_action_required', entityId: sourceUnitId }] };
  }
  if (sourceUnitId === targetUnitId) {
    return { ok: false, issues: [{ code: 'distinct_target_unit_required', entityId: sourceUnitId }] };
  }
  const source = graph.units.find((row) => row.id === sourceUnitId && row.tenantId === graph.tenantId &&
    row.lifecycleStatus === 'active');
  const target = graph.units.find((row) => row.id === targetUnitId && row.tenantId === graph.tenantId &&
    row.lifecycleStatus === 'active');
  if (!source || !source.managerPersonId) {
    return { ok: false, issues: [{ code: 'active_source_unit_required', entityId: sourceUnitId }] };
  }
  if (!target) {
    return { ok: false, issues: [{ code: 'active_target_unit_required', entityId: targetUnitId }] };
  }
  const manager = graph.people.find((row) => row.id === source.managerPersonId &&
    row.tenantId === graph.tenantId && row.lifecycleStatus === 'active' && row.primaryRole === 'manager');
  if (!manager) {
    return { ok: false, issues: [{ code: 'active_source_manager_required', entityId: sourceUnitId }] };
  }
  const teamIds = graph.teams.filter((row) => row.unitId === sourceUnitId &&
    row.tenantId === graph.tenantId && row.lifecycleStatus !== 'inactive').map((row) => row.id);
  // Every placement referencing a moved Team must follow its composite (team, unit, tenant) key,
  // including historical inactive placements. Direct inactive placements stay with the old Unit.
  const placements = graph.placements.filter((row) => row.unitId === sourceUnitId &&
    row.tenantId === graph.tenantId &&
    (row.lifecycleStatus !== 'inactive' || (row.teamId !== null && teamIds.includes(row.teamId))))
    .map((row) => ({ id: row.id, teamId: row.teamId }));
  const proposed: ActiveHierarchyGraph = {
    ...graph,
    people: graph.people.map((row) => row.id === manager.id
      ? managerAction === 'become_employee'
        ? { ...row, primaryRole: 'employee' }
        : { ...row, lifecycleStatus: 'inactive' }
      : row),
    units: graph.units.map((row) => row.id === sourceUnitId
      ? { ...row, lifecycleStatus: 'inactive' } : row),
    teams: graph.teams.map((row) => teamIds.includes(row.id)
      ? { ...row, unitId: targetUnitId } : row),
    placements: [
      ...graph.placements.map((row) => placements.some((placement) => placement.id === row.id)
        ? { ...row, unitId: targetUnitId } : row),
      ...managerAction === 'become_employee' ? [{
        id: `new-placement-for-${manager.id}`, tenantId: graph.tenantId,
        employeePersonId: manager.id, unitId: targetUnitId,
        teamId: null, lifecycleStatus: 'active',
      }] : [],
    ],
  };
  const issues = validateActiveHierarchy(proposed);
  return issues.length > 0 ? { ok: false, issues } : {
    ok: true, sourceUnitId, targetUnitId, managerPersonId: manager.id,
    managerAction, teamIds, placements,
  };
}
