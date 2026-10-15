export type AdminTeamHierarchyRole = 'employee' | 'team_lead' | 'manager' | 'hr' | 'hrbp' | 'leadership';

export type AdminTeamHierarchySource = 'org' | 'legacy' | 'none';

/** Carries only a display name and role; never email or employee id. */
export interface AdminTeamHierarchyPerson {
  id: string;
  displayName: string;
  role: AdminTeamHierarchyRole;
}

/**
 * A legacy team manager whose Slack id resolves to no active linked account has
 * `id: null` and the raw Slack id as `displayName` (the only Slack id exposed,
 * so QA can see which manager mapping is missing).
 */
export interface AdminTeamHierarchyManager extends Omit<AdminTeamHierarchyPerson, 'id'> {
  id: string | null;
}

export interface AdminTeamHierarchyTeam {
  id: string;
  name: string;
  /** null when no active lead is assigned. */
  lead: AdminTeamHierarchyPerson | null;
  members: AdminTeamHierarchyPerson[];
}

export interface AdminTeamHierarchyUnit {
  id: string;
  name: string;
  /** null when no active manager is assigned. */
  manager: AdminTeamHierarchyManager | null;
  teams: AdminTeamHierarchyTeam[];
  /** People placed in the unit without a team. */
  directMembers: AdminTeamHierarchyPerson[];
}

/**
 * An active tenant user who belongs on the team (active legacy team member or
 * current V2 cohort participant) but appears nowhere in `units`.
 */
export interface AdminTeamHierarchyUnplacedPerson {
  id: string;
  displayName: string;
  /** The person's active legacy team, when they have one. */
  legacyTeam: { name: string; manager: AdminTeamHierarchyManager | null } | null;
  inCurrentCohort: boolean;
}

export interface AdminTeamHierarchyResponse {
  tenantId: string;
  source: AdminTeamHierarchySource;
  checkedAt: string;
  units: AdminTeamHierarchyUnit[];
  /** People missing from `units`, sorted by name. */
  unplaced: AdminTeamHierarchyUnplacedPerson[];
}
