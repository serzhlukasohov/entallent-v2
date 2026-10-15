import { BadRequestException, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type {
  AdminTeamHierarchyManager, AdminTeamHierarchyPerson, AdminTeamHierarchyResponse, AdminTeamHierarchyRole,
  AdminTeamHierarchyTeam, AdminTeamHierarchyUnit,
} from '@entalent/contracts';
import { DatabaseService } from '../database/database.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type OrgUnitRow = {
  id: string; name: string;
  managerId: string | null; managerName: string | null; managerRole: string | null;
};
export type OrgTeamRow = {
  id: string; unitId: string; name: string;
  leadId: string | null; leadName: string | null; leadRole: string | null;
};
export type OrgPlacementRow = {
  personId: string; unitId: string; teamId: string | null; displayName: string; role: string;
};
export type LegacyTeamRow = {
  id: string; name: string; managerSlackUserId: string | null;
  managerUserId: string | null; managerName: string | null;
};
export type LegacyMemberRow = { teamId: string; userId: string; displayName: string | null };

const byName = (a: { displayName: string }, b: { displayName: string }) =>
  a.displayName.localeCompare(b.displayName, 'ru');

function person(id: string, displayName: string, role: string): AdminTeamHierarchyPerson {
  return { id, displayName, role: role as AdminTeamHierarchyRole };
}

const nameOf = (value: string | null | undefined): string | null => (value?.trim() ? value.trim() : null);

/** Rows are already limited to active records; inactive people arrive as null manager/lead. */
export function buildOrgHierarchy(
  units: OrgUnitRow[], teams: OrgTeamRow[], placements: OrgPlacementRow[],
): AdminTeamHierarchyUnit[] {
  return units.map((unit) => {
    const manager = unit.managerId && unit.managerName
      ? person(unit.managerId, unit.managerName, unit.managerRole ?? 'manager') : null;
    const unitTeams = teams.filter((team) => team.unitId === unit.id);
    const leads = unitTeams.map((team) => (team.leadId && team.leadName
      ? person(team.leadId, team.leadName, team.leadRole ?? 'team_lead') : null));
    // Managers and leads are shown once, in their header slot, never again as members.
    const headerIds = new Set([manager?.id, ...leads.map((lead) => lead?.id)].filter(Boolean));
    const activeTeamIds = new Set(unitTeams.map((team) => team.id));
    const unitPlacements = placements.filter((p) => p.unitId === unit.id && !headerIds.has(p.personId));
    const teamsOut: AdminTeamHierarchyTeam[] = unitTeams.map((team, index) => ({
      id: team.id,
      name: team.name,
      lead: leads[index] ?? null,
      members: unitPlacements.filter((p) => p.teamId === team.id)
        .map((p) => person(p.personId, p.displayName, p.role)).sort(byName),
    })).sort((a, b) => a.name.localeCompare(b.name, 'ru'));
    // An active placement in a team that is not active still belongs to the unit.
    const directMembers = unitPlacements
      .filter((p) => p.teamId === null || !activeTeamIds.has(p.teamId))
      .map((p) => person(p.personId, p.displayName, p.role))
      .sort(byName);
    return { id: unit.id, name: unit.name, manager, teams: teamsOut, directMembers };
  }).sort((a, b) => a.name.localeCompare(b.name, 'ru'));
}

/** Each legacy team becomes one unit; its active members are the unit's direct members. */
export function buildLegacyHierarchy(teams: LegacyTeamRow[], members: LegacyMemberRow[]): AdminTeamHierarchyUnit[] {
  return teams.map((team) => {
    const slackId = nameOf(team.managerSlackUserId);
    const manager: AdminTeamHierarchyManager | null = team.managerUserId
      ? { id: team.managerUserId, displayName: nameOf(team.managerName) ?? slackId ?? 'Руководитель', role: 'manager' }
      : slackId ? { id: null, displayName: slackId, role: 'manager' } : null;
    const seen = new Set<string>();
    let unnamed = 0;
    const directMembers = members
      .filter((m) => m.teamId === team.id && m.userId !== manager?.id)
      .filter((m) => !seen.has(m.userId) && Boolean(seen.add(m.userId)))
      .sort((a, b) => (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0))
      .map((m) => person(m.userId, nameOf(m.displayName) ?? `Участник ${++unnamed}`, 'employee'))
      .sort(byName);
    return { id: team.id, name: team.name, manager, teams: [], directMembers };
  }).sort((a, b) => a.name.localeCompare(b.name, 'ru'));
}

@Injectable()
export class TeamHierarchyReadModel {
  constructor(private readonly db: DatabaseService) {}

  async getHierarchy(tenantIdRaw: unknown): Promise<AdminTeamHierarchyResponse> {
    if (typeof tenantIdRaw !== 'string' || !UUID.test(tenantIdRaw)) {
      throw new BadRequestException('tenantId must be a UUID');
    }
    const tenantId = tenantIdRaw;
    const checkedAt = new Date().toISOString();

    // Only names and roles are selected; emails, employee ids, and Slack ids of employees stay in the database.
    const units = await this.db.client.execute(sql`
      SELECT u.id, u.name, mp.id AS "managerId", mp.display_name AS "managerName", mp.primary_role AS "managerRole"
      FROM org_units u
      LEFT JOIN people mp ON mp.id = u.manager_person_id AND mp.tenant_id = u.tenant_id
        AND mp.lifecycle_status = 'active'
      WHERE u.tenant_id = ${tenantId} AND u.lifecycle_status = 'active'
    `) as unknown as OrgUnitRow[];

    if (units.length > 0) {
      const teams = await this.db.client.execute(sql`
        SELECT t.id, t.unit_id AS "unitId", t.name,
               lp.id AS "leadId", lp.display_name AS "leadName", lp.primary_role AS "leadRole"
        FROM org_teams t
        LEFT JOIN people lp ON lp.id = t.team_lead_person_id AND lp.tenant_id = t.tenant_id
          AND lp.lifecycle_status = 'active'
        WHERE t.tenant_id = ${tenantId} AND t.lifecycle_status = 'active'
      `) as unknown as OrgTeamRow[];
      const placements = await this.db.client.execute(sql`
        SELECT p.employee_person_id AS "personId", p.unit_id AS "unitId", p.team_id AS "teamId",
               pe.display_name AS "displayName", pe.primary_role AS role
        FROM org_employee_placements p
        JOIN people pe ON pe.id = p.employee_person_id AND pe.tenant_id = p.tenant_id
          AND pe.lifecycle_status = 'active'
        WHERE p.tenant_id = ${tenantId} AND p.lifecycle_status = 'active'
      `) as unknown as OrgPlacementRow[];
      return { tenantId, source: 'org', checkedAt, units: buildOrgHierarchy(units, teams, placements) };
    }

    const legacyTeams = await this.db.client.execute(sql`
      SELECT t.id, t.name, t.manager_slack_user_id AS "managerSlackUserId",
             mgr.user_id AS "managerUserId", mgr.display_name AS "managerName"
      FROM teams t
      LEFT JOIN LATERAL (
        SELECT ca.user_id, ca.display_name FROM channel_accounts ca
        JOIN users mu ON mu.id = ca.user_id AND mu.tenant_id = ca.tenant_id
          AND mu.deleted_at IS NULL AND mu.status = 'active'
        WHERE ca.tenant_id = t.tenant_id AND ca.channel_type = 'slack' AND ca.link_status = 'linked'
          AND ca.external_user_id = t.manager_slack_user_id
        ORDER BY ca.updated_at DESC LIMIT 1
      ) mgr ON true
      WHERE t.tenant_id = ${tenantId}
    `) as unknown as LegacyTeamRow[];
    if (legacyTeams.length === 0) return { tenantId, source: 'none', checkedAt, units: [] };

    const members = await this.db.client.execute(sql`
      SELECT m.team_id AS "teamId", m.user_id AS "userId", acc.display_name AS "displayName"
      FROM team_memberships m
      JOIN teams t ON t.id = m.team_id AND t.tenant_id = ${tenantId}
      JOIN users u ON u.id = m.user_id AND u.tenant_id = ${tenantId}
        AND u.deleted_at IS NULL AND u.status = 'active'
      LEFT JOIN LATERAL (
        SELECT ca.display_name FROM channel_accounts ca
        WHERE ca.tenant_id = ${tenantId} AND ca.user_id = m.user_id AND ca.channel_type = 'slack'
          AND ca.link_status = 'linked'
        ORDER BY ca.updated_at DESC LIMIT 1
      ) acc ON true
      WHERE m.left_at IS NULL AND m.role = 'member'
    `) as unknown as LegacyMemberRow[];
    return { tenantId, source: 'legacy', checkedAt, units: buildLegacyHierarchy(legacyTeams, members) };
  }
}
