import type { PrimaryOrgRole } from './draft-person';

type LifecycleStatus = 'draft' | 'active' | 'inactive';

export interface ActivationPerson {
  id: string;
  tenantId: string;
  primaryRole: PrimaryOrgRole;
  lifecycleStatus: LifecycleStatus;
  slackLinked: boolean;
}

export interface ActivationUnit {
  id: string;
  tenantId: string;
  lifecycleStatus: LifecycleStatus;
  managerPersonId: string | null;
}

export interface ActivationTeam {
  id: string;
  tenantId: string;
  unitId: string;
  lifecycleStatus: LifecycleStatus;
  teamLeadPersonId: string | null;
}

export interface ActivationPlacement {
  id: string;
  tenantId: string;
  unitId: string;
  teamId: string | null;
  employeePersonId: string;
  lifecycleStatus: LifecycleStatus;
}

export interface UnitActivationGraph {
  unit: ActivationUnit;
  people: ActivationPerson[];
  teams: ActivationTeam[];
  placements: ActivationPlacement[];
  scopedPeople?: Array<{ id: string; role: 'hr' | 'hrbp' | 'leadership'; assignmentId?: string }>;
}

export interface UnitActivationPlan {
  ready: boolean;
  activatePersonIds: string[];
  activateTeamIds: string[];
  pendingPersonIds: string[];
  issues: Array<{ code: string; entityId: string }>;
}

export function planUnitActivation(graph: UnitActivationGraph): UnitActivationPlan {
  const { unit } = graph;
  const issues: UnitActivationPlan['issues'] = [];
  if (unit.lifecycleStatus === 'inactive') issues.push({ code: 'unit_inactive', entityId: unit.id });

  const people = new Map(graph.people.map((person) => [person.id, person]));
  const pending = new Set<string>();
  const readyPeople = new Set<string>();
  const readyTeams: string[] = [];

  function eligible(personId: string | null, role: PrimaryOrgRole, ownerId: string): string | null {
    if (!personId) {
      issues.push({ code: `missing_${role}`, entityId: ownerId });
      return null;
    }
    const person = people.get(personId);
    if (!person || person.tenantId !== unit.tenantId || person.primaryRole !== role || person.lifecycleStatus === 'inactive') {
      issues.push({ code: `invalid_${role}`, entityId: ownerId });
      return null;
    }
    if (!person.slackLinked) {
      pending.add(person.id);
      return null;
    }
    return person.id;
  }

  const managerId = eligible(unit.managerPersonId, 'manager', unit.id);
  if (managerId) readyPeople.add(managerId);

  const directEmployees: string[] = [];
  const membersByTeam = new Map<string, string[]>();
  const placementCount = new Map<string, number>();
  for (const placement of graph.placements) {
    if (placement.lifecycleStatus === 'inactive') continue;
    if (placement.tenantId !== unit.tenantId || placement.unitId !== unit.id) {
      issues.push({ code: 'invalid_placement_scope', entityId: placement.id });
      continue;
    }
    placementCount.set(placement.employeePersonId, (placementCount.get(placement.employeePersonId) ?? 0) + 1);
    const employeeId = eligible(placement.employeePersonId, 'employee', placement.id);
    if (!employeeId) continue;
    if (placement.teamId === null) directEmployees.push(employeeId);
    else membersByTeam.set(placement.teamId, [...(membersByTeam.get(placement.teamId) ?? []), employeeId]);
  }
  for (const [personId, count] of placementCount) {
    if (count > 1) issues.push({ code: 'duplicate_employee_placement', entityId: personId });
  }

  const leadCount = new Map<string, number>();
  for (const team of graph.teams) {
    if (team.lifecycleStatus === 'inactive') continue;
    if (team.tenantId !== unit.tenantId || team.unitId !== unit.id) {
      issues.push({ code: 'invalid_team_scope', entityId: team.id });
      continue;
    }
    const leadId = eligible(team.teamLeadPersonId, 'team_lead', team.id);
    if (leadId) leadCount.set(leadId, (leadCount.get(leadId) ?? 0) + 1);
    const members = membersByTeam.get(team.id) ?? [];
    if (!leadId || members.length === 0) {
      if (members.length === 0) issues.push({
        code: team.lifecycleStatus === 'active' ? 'active_team_without_ready_employee' : 'team_without_ready_employee',
        entityId: team.id,
      });
      if (!leadId && team.lifecycleStatus === 'active') issues.push({ code: 'active_team_without_lead', entityId: team.id });
      if (leadId) pending.add(leadId);
      for (const member of members) pending.add(member);
      continue;
    }
    readyTeams.push(team.id);
    readyPeople.add(leadId);
    for (const member of members) readyPeople.add(member);
  }
  for (const [personId, count] of leadCount) {
    if (count > 1) issues.push({ code: 'duplicate_team_lead', entityId: personId });
  }

  for (const [teamId, members] of membersByTeam) {
    if (graph.teams.some((team) => team.id === teamId && team.tenantId === unit.tenantId && team.unitId === unit.id && team.lifecycleStatus !== 'inactive')) continue;
    issues.push({ code: 'unknown_team', entityId: teamId });
    for (const member of members) pending.add(member);
  }

  for (const employeeId of directEmployees) readyPeople.add(employeeId);
  for (const scoped of graph.scopedPeople ?? []) {
    const personId = eligible(scoped.id, scoped.role, unit.id);
    if (personId) readyPeople.add(personId);
  }
  if (directEmployees.length === 0 && readyTeams.length === 0) {
    issues.push({ code: 'unit_without_ready_subordinate', entityId: unit.id });
  }

  const ready = managerId !== null && issues.every((issue) => ![
    'unit_inactive', 'invalid_manager', 'missing_manager', 'invalid_employee', 'invalid_team_lead',
    'invalid_placement_scope', 'invalid_team_scope', 'unknown_team', 'duplicate_employee_placement',
    'duplicate_team_lead', 'unit_without_ready_subordinate', 'active_team_without_ready_employee',
    'active_team_without_lead',
  ].includes(issue.code));
  if (!ready) for (const id of readyPeople) pending.add(id);
  return {
    ready,
    activatePersonIds: ready ? [...readyPeople].sort() : [],
    activateTeamIds: ready ? readyTeams.sort() : [],
    pendingPersonIds: [...pending].filter((id) => !ready || !readyPeople.has(id)).sort(),
    issues,
  };
}
