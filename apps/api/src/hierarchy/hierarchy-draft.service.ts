import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { and, eq, inArray, ne } from 'drizzle-orm';
import {
  DraftPersonValidationError, DraftStructureValidationError,
  prepareDraftPerson, prepareDraftTeam, prepareDraftUnit,
  validateHierarchyCsv,
  type DraftPersonInput, type DraftTeamInput, type DraftUnitInput,
  type HierarchyCsvError, type ExistingHierarchyForImport,
  type HierarchyCsvValidation,
} from '@entalent/application';
import {
  auditLogs, channelAccounts, orgAdvisorAssignments, orgEmployeePlacements, orgHrbpScopes,
  orgPersonCapabilities, orgTeams, orgUnits, people, users,
  type DbOrgEmployeePlacement, type DbOrgTeam, type DbOrgUnit, type DbPerson,
} from '@entalent/database';
import { DatabaseService } from '../database/database.service';
import { actorId, assertHierarchyActorAuthorized, HierarchyAuthorizationError, type HierarchyActor } from './hierarchy-authorization';
import { withSerializableRetry } from './serializable-retry';

export { HierarchyAuthorizationError } from './hierarchy-authorization';
export type { HierarchyActor } from './hierarchy-authorization';

export class HierarchyDraftReferenceError extends Error {
  constructor(readonly field: string, readonly code: string) {
    super(`${field}: ${code}`);
    this.name = 'HierarchyDraftReferenceError';
  }
}

export class HierarchyCsvValidationError extends Error {
  constructor(readonly errors: HierarchyCsvError[]) {
    super(`Hierarchy CSV has ${errors.length} validation error(s)`);
    this.name = 'HierarchyCsvValidationError';
  }
}

export interface HierarchyImportResult {
  personIds: string[];
  unitIds: string[];
  teamIds: string[];
}

@Injectable()
export class HierarchyDraftService {
  constructor(private readonly db: DatabaseService) {}

  async previewCsv(tenantId: string, csv: string, actor: HierarchyActor): Promise<HierarchyCsvValidation> {
    await this.db.client.transaction(async (tx) => assertHierarchyActorAuthorized(tx, tenantId, actor));
    const [existingPeople, existingUnits, existingTeams] = await Promise.all([
      this.db.client.select({
        tenantId: people.tenantId, customerEmployeeId: people.customerEmployeeId, workEmail: people.workEmail,
      }).from(people).where(eq(people.tenantId, tenantId)),
      this.db.client.select({
        id: orgUnits.id, tenantId: orgUnits.tenantId, customerUnitKey: orgUnits.customerUnitKey, name: orgUnits.name,
      }).from(orgUnits).where(eq(orgUnits.tenantId, tenantId)),
      this.db.client.select({
        id: orgTeams.id, tenantId: orgTeams.tenantId, customerTeamKey: orgTeams.customerTeamKey,
        customerUnitKey: orgUnits.customerUnitKey, name: orgTeams.name,
      }).from(orgTeams).innerJoin(orgUnits, and(
        eq(orgUnits.id, orgTeams.unitId), eq(orgUnits.tenantId, orgTeams.tenantId),
      )).where(eq(orgTeams.tenantId, tenantId)),
    ]);
    return validateHierarchyCsv(csv, tenantId, {
      people: existingPeople, units: existingUnits, teams: existingTeams,
    });
  }

  async createPerson(tenantId: string, input: DraftPersonInput, actor: HierarchyActor): Promise<DbPerson> {
    try {
      const prepared = prepareDraftPerson(input);
      return await this.db.client.transaction(async (tx) => {
        await assertHierarchyActorAuthorized(tx, tenantId, actor);

        const [user] = await tx.insert(users).values({
          tenantId,
          status: 'inactive',
          proactiveMessagingEnabled: false,
        }).returning({ id: users.id });
        if (!user) throw new Error('user insert returned no row');

        const [person] = await tx.insert(people).values({
          id: user.id,
          tenantId,
          ...prepared,
        }).returning();
        if (!person) throw new Error('person insert returned no row');

        await tx.insert(auditLogs).values({
          tenantId,
          actorType: actor.type,
          actorId: actorId(actor),
          action: 'org.person.create_draft',
          resourceType: 'person',
          resourceId: person.id,
          metadata: { before: null, after: person },
        });
        return person;
      });
    } catch (error) {
      await this.auditRejected(tenantId, actor, 'person', error, { customerEmployeeId: input.customerEmployeeId?.trim() || null });
      throw error;
    }
  }

  async createUnit(tenantId: string, input: DraftUnitInput, actor: HierarchyActor): Promise<DbOrgUnit> {
    try {
      const prepared = prepareDraftUnit(input);
      return await this.db.client.transaction(async (tx) => {
        await assertHierarchyActorAuthorized(tx, tenantId, actor);
        if (prepared.managerPersonId) {
          const [manager] = await tx.select({ id: people.id }).from(people).where(and(
            eq(people.id, prepared.managerPersonId), eq(people.tenantId, tenantId),
            eq(people.primaryRole, 'manager'), ne(people.lifecycleStatus, 'inactive'),
          )).limit(1);
          if (!manager) throw new HierarchyDraftReferenceError('managerPersonId', 'invalid_manager');
        }
        const [unit] = await tx.insert(orgUnits).values({ tenantId, ...prepared }).returning();
        if (!unit) throw new Error('unit insert returned no row');
        await tx.insert(auditLogs).values({
          tenantId, actorType: actor.type, actorId: actorId(actor), action: 'org.unit.create_draft',
          resourceType: 'unit', resourceId: unit.id, metadata: { before: null, after: unit },
        });
        return unit;
      });
    } catch (error) {
      await this.auditRejected(tenantId, actor, 'unit', error, { customerUnitKey: input.customerUnitKey?.trim() || null });
      throw error;
    }
  }

  async createTeam(tenantId: string, input: DraftTeamInput, actor: HierarchyActor): Promise<DbOrgTeam> {
    try {
      const prepared = prepareDraftTeam(input);
      return await this.db.client.transaction(async (tx) => {
        await assertHierarchyActorAuthorized(tx, tenantId, actor);
        const [unit] = await tx.select({ id: orgUnits.id }).from(orgUnits).where(and(
          eq(orgUnits.id, prepared.unitId), eq(orgUnits.tenantId, tenantId),
          ne(orgUnits.lifecycleStatus, 'inactive'),
        )).limit(1);
        if (!unit) throw new HierarchyDraftReferenceError('unitId', 'invalid_unit');
        if (prepared.teamLeadPersonId) {
          const [lead] = await tx.select({ id: people.id }).from(people).where(and(
            eq(people.id, prepared.teamLeadPersonId), eq(people.tenantId, tenantId),
            eq(people.primaryRole, 'team_lead'), ne(people.lifecycleStatus, 'inactive'),
          )).limit(1);
          if (!lead) throw new HierarchyDraftReferenceError('teamLeadPersonId', 'invalid_team_lead');
        }
        const [team] = await tx.insert(orgTeams).values({ tenantId, ...prepared }).returning();
        if (!team) throw new Error('team insert returned no row');
        await tx.insert(auditLogs).values({
          tenantId, actorType: actor.type, actorId: actorId(actor), action: 'org.team.create_draft',
          resourceType: 'team', resourceId: team.id, metadata: { before: null, after: team },
        });
        return team;
      });
    } catch (error) {
      await this.auditRejected(tenantId, actor, 'team', error, { customerTeamKey: input.customerTeamKey?.trim() || null });
      throw error;
    }
  }

  async updatePerson(tenantId: string, personId: string, input: DraftPersonInput, actor: HierarchyActor): Promise<DbPerson> {
    try {
      const prepared = prepareDraftPerson(input);
      return await withSerializableRetry(() => this.db.client.transaction(async (tx) => {
        await assertHierarchyActorAuthorized(tx, tenantId, actor);
        const [before] = await tx.select().from(people).where(and(
          eq(people.id, personId), eq(people.tenantId, tenantId),
        )).for('update').limit(1);
        if (!before || before.lifecycleStatus !== 'draft') {
          throw new HierarchyDraftReferenceError('personId', 'draft_person_required');
        }
        if (prepared.workEmail !== before.workEmail) {
          const [link] = await tx.select({ id: channelAccounts.id }).from(channelAccounts).where(and(
            eq(channelAccounts.tenantId, tenantId), eq(channelAccounts.userId, personId),
            eq(channelAccounts.linkStatus, 'linked'),
          )).limit(1);
          if (link) throw new HierarchyDraftReferenceError('workEmail', 'unlink_slack_first');
        }
        if (prepared.primaryRole !== before.primaryRole) {
          const [ownedUnits, ownedTeams, placements, advisors, hrbpScopes] = await Promise.all([
            tx.select({ id: orgUnits.id }).from(orgUnits).where(and(
              eq(orgUnits.tenantId, tenantId), eq(orgUnits.managerPersonId, personId),
              ne(orgUnits.lifecycleStatus, 'inactive'))),
            tx.select({ id: orgTeams.id }).from(orgTeams).where(and(
              eq(orgTeams.tenantId, tenantId), eq(orgTeams.teamLeadPersonId, personId),
              ne(orgTeams.lifecycleStatus, 'inactive'))),
            tx.select({ id: orgEmployeePlacements.id }).from(orgEmployeePlacements).where(and(
              eq(orgEmployeePlacements.tenantId, tenantId), eq(orgEmployeePlacements.employeePersonId, personId),
              ne(orgEmployeePlacements.lifecycleStatus, 'inactive'))),
            tx.select({ id: orgAdvisorAssignments.id }).from(orgAdvisorAssignments).where(and(
              eq(orgAdvisorAssignments.tenantId, tenantId), eq(orgAdvisorAssignments.advisorPersonId, personId),
              ne(orgAdvisorAssignments.lifecycleStatus, 'inactive'))),
            tx.select({ personId: orgHrbpScopes.personId }).from(orgHrbpScopes).where(and(
              eq(orgHrbpScopes.tenantId, tenantId), eq(orgHrbpScopes.personId, personId),
              ne(orgHrbpScopes.lifecycleStatus, 'inactive'))),
          ]);
          if (ownedUnits.length && prepared.primaryRole !== 'manager') throw new HierarchyDraftReferenceError('primaryRole', 'unit_owner_reference');
          if (ownedTeams.length && prepared.primaryRole !== 'team_lead') throw new HierarchyDraftReferenceError('primaryRole', 'team_owner_reference');
          if (placements.length && prepared.primaryRole !== 'employee') throw new HierarchyDraftReferenceError('primaryRole', 'employee_placement_reference');
          if (advisors.length && prepared.primaryRole !== 'hr' && prepared.primaryRole !== 'hrbp') throw new HierarchyDraftReferenceError('primaryRole', 'advisor_scope_reference');
          if (hrbpScopes.length && prepared.primaryRole !== 'hrbp') throw new HierarchyDraftReferenceError('primaryRole', 'hrbp_scope_reference');
        }
        const [after] = await tx.update(people).set({ ...prepared, updatedAt: new Date() }).where(and(
          eq(people.id, personId), eq(people.tenantId, tenantId), eq(people.lifecycleStatus, 'draft'),
        )).returning();
        if (!after) throw new HierarchyDraftReferenceError('personId', 'draft_person_required');
        await tx.insert(auditLogs).values({ tenantId, actorType: actor.type, actorId: actorId(actor),
          action: 'org.person.update_draft', resourceType: 'person', resourceId: personId,
          metadata: { before, after } });
        return after;
      }, { isolationLevel: 'serializable' }));
    } catch (error) {
      await this.auditUpdateRejected(tenantId, actor, 'person', personId, error);
      throw error;
    }
  }

  async updateUnit(tenantId: string, unitId: string, input: DraftUnitInput, actor: HierarchyActor): Promise<DbOrgUnit> {
    try {
      const prepared = prepareDraftUnit(input);
      return await withSerializableRetry(() => this.db.client.transaction(async (tx) => {
        await assertHierarchyActorAuthorized(tx, tenantId, actor);
        const [before] = await tx.select().from(orgUnits).where(and(
          eq(orgUnits.id, unitId), eq(orgUnits.tenantId, tenantId),
        )).for('update').limit(1);
        if (!before || before.lifecycleStatus !== 'draft') throw new HierarchyDraftReferenceError('unitId', 'draft_unit_required');
        if (prepared.managerPersonId) {
          const [manager] = await tx.select({ id: people.id }).from(people).where(and(
            eq(people.id, prepared.managerPersonId), eq(people.tenantId, tenantId),
            eq(people.primaryRole, 'manager'), ne(people.lifecycleStatus, 'inactive'),
          )).limit(1);
          if (!manager) throw new HierarchyDraftReferenceError('managerPersonId', 'invalid_manager');
        }
        const [after] = await tx.update(orgUnits).set({ ...prepared, updatedAt: new Date() }).where(and(
          eq(orgUnits.id, unitId), eq(orgUnits.tenantId, tenantId), eq(orgUnits.lifecycleStatus, 'draft'),
        )).returning();
        if (!after) throw new HierarchyDraftReferenceError('unitId', 'draft_unit_required');
        await tx.insert(auditLogs).values({ tenantId, actorType: actor.type, actorId: actorId(actor),
          action: 'org.unit.update_draft', resourceType: 'unit', resourceId: unitId,
          metadata: { before, after } });
        return after;
      }, { isolationLevel: 'serializable' }));
    } catch (error) {
      await this.auditUpdateRejected(tenantId, actor, 'unit', unitId, error);
      throw error;
    }
  }

  async updateTeam(tenantId: string, teamId: string, input: DraftTeamInput, actor: HierarchyActor): Promise<DbOrgTeam> {
    try {
      const prepared = prepareDraftTeam(input);
      return await withSerializableRetry(() => this.db.client.transaction(async (tx) => {
        await assertHierarchyActorAuthorized(tx, tenantId, actor);
        const [before] = await tx.select().from(orgTeams).where(and(
          eq(orgTeams.id, teamId), eq(orgTeams.tenantId, tenantId),
        )).for('update').limit(1);
        if (!before || before.lifecycleStatus !== 'draft') throw new HierarchyDraftReferenceError('teamId', 'draft_team_required');
        const [unit] = await tx.select({ id: orgUnits.id }).from(orgUnits).where(and(
          eq(orgUnits.id, prepared.unitId), eq(orgUnits.tenantId, tenantId),
          ne(orgUnits.lifecycleStatus, 'inactive'),
        )).limit(1);
        if (!unit) throw new HierarchyDraftReferenceError('unitId', 'invalid_unit');
        if (prepared.teamLeadPersonId) {
          const [lead] = await tx.select({ id: people.id }).from(people).where(and(
            eq(people.id, prepared.teamLeadPersonId), eq(people.tenantId, tenantId),
            eq(people.primaryRole, 'team_lead'), ne(people.lifecycleStatus, 'inactive'),
          )).limit(1);
          if (!lead) throw new HierarchyDraftReferenceError('teamLeadPersonId', 'invalid_team_lead');
        }
        let movedPlacementIds: string[] = [];
        if (prepared.unitId !== before.unitId) {
          const placements = await tx.select({ id: orgEmployeePlacements.id,
            lifecycleStatus: orgEmployeePlacements.lifecycleStatus }).from(orgEmployeePlacements).where(and(
            eq(orgEmployeePlacements.tenantId, tenantId), eq(orgEmployeePlacements.teamId, teamId),
          )).for('update');
          if (placements.some((row) => row.lifecycleStatus === 'active')) {
            throw new HierarchyDraftReferenceError('unitId', 'active_placement_reference');
          }
          movedPlacementIds = placements.map((row) => row.id);
          if (placements.length) {
            await tx.update(orgEmployeePlacements).set({ teamId: null, unitId: prepared.unitId,
              updatedAt: new Date() }).where(and(
              eq(orgEmployeePlacements.tenantId, tenantId), eq(orgEmployeePlacements.teamId, teamId),
            ));
          }
        }
        const [after] = await tx.update(orgTeams).set({ ...prepared, updatedAt: new Date() }).where(and(
          eq(orgTeams.id, teamId), eq(orgTeams.tenantId, tenantId), eq(orgTeams.lifecycleStatus, 'draft'),
        )).returning();
        if (!after) throw new HierarchyDraftReferenceError('teamId', 'draft_team_required');
        if (movedPlacementIds.length) {
          await tx.update(orgEmployeePlacements).set({ teamId, updatedAt: new Date() }).where(and(
            eq(orgEmployeePlacements.tenantId, tenantId), eq(orgEmployeePlacements.unitId, prepared.unitId),
            inArray(orgEmployeePlacements.id, movedPlacementIds),
          ));
        }
        await tx.insert(auditLogs).values({ tenantId, actorType: actor.type, actorId: actorId(actor),
          action: 'org.team.update_draft', resourceType: 'team', resourceId: teamId,
          metadata: { before, after } });
        return after;
      }, { isolationLevel: 'serializable' }));
    } catch (error) {
      await this.auditUpdateRejected(tenantId, actor, 'team', teamId, error);
      throw error;
    }
  }

  async replaceDraftPlacement(tenantId: string, personId: string,
    targetUnitId: string | null, targetTeamId: string | null,
    actor: HierarchyActor): Promise<DbOrgEmployeePlacement | null> {
    try {
      if (targetTeamId && !targetUnitId) throw new HierarchyDraftReferenceError('targetUnitId', 'required_for_team');
      return await withSerializableRetry(() => this.db.client.transaction(async (tx) => {
        await assertHierarchyActorAuthorized(tx, tenantId, actor);
        const [person] = await tx.select({ id: people.id, primaryRole: people.primaryRole,
          lifecycleStatus: people.lifecycleStatus }).from(people).where(and(
          eq(people.id, personId), eq(people.tenantId, tenantId),
        )).for('update').limit(1);
        if (!person || person.lifecycleStatus !== 'draft' || person.primaryRole !== 'employee') {
          throw new HierarchyDraftReferenceError('personId', 'draft_employee_required');
        }
        const placements = await tx.select().from(orgEmployeePlacements).where(and(
          eq(orgEmployeePlacements.tenantId, tenantId), eq(orgEmployeePlacements.employeePersonId, personId),
          ne(orgEmployeePlacements.lifecycleStatus, 'inactive'),
        )).for('update');
        if (placements.length > 1 || placements.some((row) => row.lifecycleStatus !== 'draft')) {
          throw new HierarchyDraftReferenceError('personId', 'ambiguous_draft_placement');
        }
        if (targetUnitId) {
          const [unit] = await tx.select({ id: orgUnits.id }).from(orgUnits).where(and(
            eq(orgUnits.id, targetUnitId), eq(orgUnits.tenantId, tenantId),
            ne(orgUnits.lifecycleStatus, 'inactive'),
          )).limit(1);
          if (!unit) throw new HierarchyDraftReferenceError('targetUnitId', 'invalid_unit');
        }
        if (targetTeamId) {
          const [team] = await tx.select({ id: orgTeams.id }).from(orgTeams).where(and(
            eq(orgTeams.id, targetTeamId), eq(orgTeams.tenantId, tenantId),
            eq(orgTeams.unitId, targetUnitId!), ne(orgTeams.lifecycleStatus, 'inactive'),
          )).limit(1);
          if (!team) throw new HierarchyDraftReferenceError('targetTeamId', 'invalid_team_for_unit');
        }
        const before = placements[0] ?? null;
        const now = new Date();
        let after: DbOrgEmployeePlacement | null = null;
        if (before && targetUnitId) {
          [after] = await tx.update(orgEmployeePlacements).set({ unitId: targetUnitId,
            teamId: targetTeamId, updatedAt: now }).where(and(
            eq(orgEmployeePlacements.id, before.id), eq(orgEmployeePlacements.tenantId, tenantId),
            eq(orgEmployeePlacements.lifecycleStatus, 'draft'),
          )).returning();
        } else if (before) {
          await tx.update(orgEmployeePlacements).set({ lifecycleStatus: 'inactive', updatedAt: now }).where(and(
            eq(orgEmployeePlacements.id, before.id), eq(orgEmployeePlacements.tenantId, tenantId),
            eq(orgEmployeePlacements.lifecycleStatus, 'draft'),
          ));
        } else if (targetUnitId) {
          [after] = await tx.insert(orgEmployeePlacements).values({ tenantId,
            employeePersonId: personId, unitId: targetUnitId, teamId: targetTeamId,
            lifecycleStatus: 'draft' }).returning();
        }
        await tx.insert(auditLogs).values({ tenantId, actorType: actor.type, actorId: actorId(actor),
          action: 'org.employee_placement.replace_draft', resourceType: 'org_employee_placement',
          resourceId: after?.id ?? before?.id ?? personId, metadata: { personId, before, after } });
        return after;
      }, { isolationLevel: 'serializable' }));
    } catch (error) {
      await this.auditUpdateRejected(tenantId, actor, 'employee_placement', personId, error, 'replace_draft');
      throw error;
    }
  }

  private async auditUpdateRejected(tenantId: string, actor: HierarchyActor, resourceType: string,
    resourceId: string, error: unknown, operation = 'update_draft'): Promise<void> {
    await this.db.client.insert(auditLogs).values({ tenantId, actorType: actor.type, actorId: actorId(actor),
      action: `org.${resourceType}.${operation}.rejected`, resourceType, resourceId,
      reason: rejectionReason(error) });
  }

  async importCsv(tenantId: string, csv: string, actor: HierarchyActor): Promise<HierarchyImportResult> {
    try {
      return await withSerializableRetry(() => this.db.client.transaction(async (tx) => {
        await assertHierarchyActorAuthorized(tx, tenantId, actor);
        const existingPeople = await tx.select({
          tenantId: people.tenantId, customerEmployeeId: people.customerEmployeeId, workEmail: people.workEmail,
        }).from(people).where(eq(people.tenantId, tenantId));
        const existingUnits = await tx.select({
          id: orgUnits.id, tenantId: orgUnits.tenantId, customerUnitKey: orgUnits.customerUnitKey, name: orgUnits.name,
        }).from(orgUnits).where(eq(orgUnits.tenantId, tenantId));
        const existingTeams = await tx.select({
          id: orgTeams.id, tenantId: orgTeams.tenantId, customerTeamKey: orgTeams.customerTeamKey,
          customerUnitKey: orgUnits.customerUnitKey, name: orgTeams.name,
        }).from(orgTeams).innerJoin(orgUnits, and(
          eq(orgUnits.id, orgTeams.unitId), eq(orgUnits.tenantId, orgTeams.tenantId),
        )).where(eq(orgTeams.tenantId, tenantId));
        const snapshot: ExistingHierarchyForImport = {
          people: existingPeople, units: existingUnits, teams: existingTeams,
        };
        const validation = validateHierarchyCsv(csv, tenantId, snapshot);
        if (!validation.ok) throw new HierarchyCsvValidationError(validation.errors);
        const rows = validation.rows;

        const personIds = new Map(rows.map((row) => [row.customerEmployeeId, randomUUID()]));
        await tx.insert(users).values(rows.map((row) => ({
          id: personIds.get(row.customerEmployeeId)!, tenantId, status: 'inactive', proactiveMessagingEnabled: false,
        })));
        await tx.insert(people).values(rows.map((row) => ({
          id: personIds.get(row.customerEmployeeId)!, tenantId,
          customerEmployeeId: row.customerEmployeeId, workEmail: row.workEmail, displayName: row.displayName,
          jobTitle: row.jobTitle, primaryRole: row.primaryRole, pulseParticipant: row.pulseParticipant,
        })));

        const unitIds = new Map(existingUnits.map((unit) => [unit.customerUnitKey, unit.id]));
        const existingUnitKeys = new Set(unitIds.keys());
        const newUnits = new Map<string, { id: string; name: string; managerPersonId: string | null }>();
        for (const row of rows) {
          if (!row.customerUnitKey || existingUnitKeys.has(row.customerUnitKey)) continue;
          const current = newUnits.get(row.customerUnitKey);
          if (!current) {
            const id = randomUUID();
            unitIds.set(row.customerUnitKey, id);
            newUnits.set(row.customerUnitKey, { id, name: row.unitName ?? '', managerPersonId: null });
          } else if (!current.name && row.unitName) current.name = row.unitName;
        }
        for (const row of rows) {
          if (row.primaryRole === 'manager' && row.customerUnitKey) {
            const unit = newUnits.get(row.customerUnitKey);
            if (unit) unit.managerPersonId = personIds.get(row.customerEmployeeId)!;
          }
        }
        if (newUnits.size > 0) await tx.insert(orgUnits).values([...newUnits.entries()].map(([customerUnitKey, unit]) => ({
          id: unit.id, tenantId, customerUnitKey, name: unit.name, managerPersonId: unit.managerPersonId,
        })));

        const teamIds = new Map(existingTeams.map((team) => [team.customerTeamKey, team.id]));
        const existingTeamKeys = new Set(teamIds.keys());
        const newTeams = new Map<string, { id: string; unitId: string; name: string; teamLeadPersonId: string | null }>();
        for (const row of rows) {
          if (!row.customerTeamKey || !row.customerUnitKey || existingTeamKeys.has(row.customerTeamKey)) continue;
          const current = newTeams.get(row.customerTeamKey);
          if (!current) {
            const id = randomUUID();
            teamIds.set(row.customerTeamKey, id);
            newTeams.set(row.customerTeamKey, {
              id, unitId: unitIds.get(row.customerUnitKey)!, name: row.teamName ?? '', teamLeadPersonId: null,
            });
          } else if (!current.name && row.teamName) current.name = row.teamName;
        }
        for (const row of rows) {
          if (row.primaryRole === 'team_lead' && row.customerTeamKey) {
            const team = newTeams.get(row.customerTeamKey);
            if (team) team.teamLeadPersonId = personIds.get(row.customerEmployeeId)!;
          }
        }
        if (newTeams.size > 0) await tx.insert(orgTeams).values([...newTeams.entries()].map(([customerTeamKey, team]) => ({
          id: team.id, tenantId, customerTeamKey, unitId: team.unitId, name: team.name,
          teamLeadPersonId: team.teamLeadPersonId,
        })));

        const employeeRows = rows.filter((row) => row.primaryRole === 'employee');
        if (employeeRows.length > 0) await tx.insert(orgEmployeePlacements).values(employeeRows.map((row) => ({
          tenantId, employeePersonId: personIds.get(row.customerEmployeeId)!,
          unitId: unitIds.get(row.customerUnitKey!)!,
          teamId: row.customerTeamKey ? teamIds.get(row.customerTeamKey)! : null,
        })));
        const advisorRows = rows.flatMap((row) => row.assignedUnitKeys.map((key) => ({
          tenantId, advisorPersonId: personIds.get(row.customerEmployeeId)!, unitId: unitIds.get(key)!,
        })));
        if (advisorRows.length > 0) await tx.insert(orgAdvisorAssignments).values(advisorRows);
        const hrbpRows = rows.filter((row) => row.primaryRole === 'hrbp');
        if (hrbpRows.length > 0) await tx.insert(orgHrbpScopes).values(hrbpRows.map((row) => ({
          personId: personIds.get(row.customerEmployeeId)!, tenantId, scopeMode: row.hrbpScopeMode!,
        })));
        const adminRows = rows.filter((row) => row.companyAdmin);
        if (adminRows.length > 0) await tx.insert(orgPersonCapabilities).values(adminRows.map((row) => ({
          personId: personIds.get(row.customerEmployeeId)!, tenantId, capability: 'company_admin',
        })));

        const result = {
          personIds: [...personIds.values()],
          unitIds: [...newUnits.values()].map((unit) => unit.id),
          teamIds: [...newTeams.values()].map((team) => team.id),
        };
        await tx.insert(auditLogs).values({
          tenantId, actorType: actor.type, actorId: actorId(actor), action: 'org.csv.import',
          resourceType: 'hierarchy_import', resourceId: randomUUID(), metadata: { before: null, after: result },
        });
        return result;
      }, { isolationLevel: 'serializable' }));
    } catch (error) {
      await this.db.client.insert(auditLogs).values({
        tenantId, actorType: actor.type, actorId: actorId(actor), action: 'org.csv.import.rejected',
        resourceType: 'hierarchy_import', resourceId: 'new', reason: rejectionReason(error),
        metadata: error instanceof HierarchyCsvValidationError
          ? { errors: error.errors.map((item) => ({ rowNumber: item.rowNumber, field: item.field, code: item.code })) }
          : {},
      });
      throw error;
    }
  }

  private async auditRejected(
    tenantId: string, actor: HierarchyActor, resourceType: string,
    error: unknown, metadata: Record<string, string | null>,
  ): Promise<void> {
    await this.db.client.insert(auditLogs).values({
      tenantId, actorType: actor.type, actorId: actorId(actor),
      action: `org.${resourceType}.create_draft.rejected`, resourceType, resourceId: 'new',
      reason: rejectionReason(error), metadata,
    });
  }
}

function rejectionReason(error: unknown): string {
  if (error instanceof HierarchyCsvValidationError) return 'csv_validation';
  if (error instanceof DraftPersonValidationError) return `${error.field}:${error.code}`;
  if (error instanceof DraftStructureValidationError) return `${error.field}:${error.code}`;
  if (error instanceof HierarchyDraftReferenceError) return `${error.field}:${error.code}`;
  if (error instanceof HierarchyAuthorizationError) return 'unauthorized';
  if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505') return 'duplicate_identity';
  return 'persistence_error';
}
