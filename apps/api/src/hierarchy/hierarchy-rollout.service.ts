import { Injectable } from '@nestjs/common';
import { and, eq, inArray, ne } from 'drizzle-orm';
import { planUnitActivation, type PrimaryOrgRole, type UnitActivationGraph, type UnitActivationPlan } from '@entalent/application';
import {
  auditLogs, channelAccounts, orgAdvisorAssignments, orgEmployeePlacements, orgHrbpScopes, orgOnboardingDeliveries, orgTeams, orgUnits,
  people, users, workspaceConnections,
  type DbClient,
} from '@entalent/database';
import { DatabaseService } from '../database/database.service';
import { actorId, assertHierarchyActorAuthorized, HierarchyAuthorizationError, type HierarchyActor } from './hierarchy-authorization';
import { withSerializableRetry } from './serializable-retry';

type Transaction = Parameters<Parameters<DbClient['db']['transaction']>[0]>[0];
type LifecycleStatus = 'draft' | 'active' | 'inactive';

export class HierarchyRolloutError extends Error {
  constructor(readonly code: string, readonly issues: UnitActivationPlan['issues'] = []) {
    super(code);
    this.name = 'HierarchyRolloutError';
  }
}

export interface UnitRolloutResult {
  unitId: string;
  activatedPersonIds: string[];
  activatedTeamIds: string[];
  pendingPersonIds: string[];
  issues: UnitActivationPlan['issues'];
}

export interface BatchRolloutPreview {
  ready: boolean;
  units: Array<{ unitId: string; plan: UnitActivationPlan }>;
}

@Injectable()
export class HierarchyRolloutService {
  constructor(private readonly db: DatabaseService) {}

  async previewUnit(
    tenantId: string, unitId: string, workspaceId: string, actor: HierarchyActor,
  ): Promise<UnitActivationPlan> {
    const preview = await this.previewUnits(tenantId, [unitId], workspaceId, actor);
    return preview.units[0]!.plan;
  }

  async previewUnits(
    tenantId: string, unitIds: string[], workspaceId: string, actor: HierarchyActor,
  ): Promise<BatchRolloutPreview> {
    const selectedIds = this.selectedUnitIds(unitIds);
    return this.db.client.transaction(async (tx) => {
      await assertHierarchyActorAuthorized(tx, tenantId, actor);
      await this.assertWorkspace(tx, tenantId, workspaceId);
      const units = [];
      for (const unitId of selectedIds) {
        units.push({ unitId, plan: planUnitActivation(await this.loadGraph(tx, tenantId, unitId, workspaceId)) });
      }
      return { ready: units.every((unit) => unit.plan.ready), units };
    });
  }

  async activateUnit(
    tenantId: string, unitId: string, workspaceId: string, actor: HierarchyActor,
  ): Promise<UnitRolloutResult> {
    const results = await this.activateUnits(tenantId, [unitId], workspaceId, actor);
    return results[0]!;
  }

  async activateUnits(
    tenantId: string, unitIds: string[], workspaceId: string, actor: HierarchyActor,
  ): Promise<UnitRolloutResult[]> {
    let selectedIds = unitIds;
    try {
      selectedIds = this.selectedUnitIds(unitIds);
      return await withSerializableRetry(() => this.db.client.transaction(async (tx) => {
        await assertHierarchyActorAuthorized(tx, tenantId, actor);
        await this.assertWorkspace(tx, tenantId, workspaceId);
        const planned = [];
        for (const unitId of selectedIds) {
          const graph = await this.loadGraph(tx, tenantId, unitId, workspaceId);
          const plan = planUnitActivation(graph);
          planned.push({ unitId, graph, plan });
        }
        const rejected = planned.filter((unit) => !unit.plan.ready);
        if (rejected.length > 0) throw new HierarchyRolloutError('unit_not_ready',
          rejected.flatMap((unit) => unit.plan.issues));

        const activated = new Set<string>();
        const results: UnitRolloutResult[] = [];
        for (const { unitId, graph, plan } of planned) {
          const newlyActivatedPersonIds = graph.people
            .filter((person) => plan.activatePersonIds.includes(person.id) &&
              person.lifecycleStatus === 'draft' && !activated.has(person.id))
            .map((person) => person.id).sort();
          newlyActivatedPersonIds.forEach((id) => activated.add(id));
          const newlyActivatedTeamIds = graph.teams
            .filter((team) => plan.activateTeamIds.includes(team.id) && team.lifecycleStatus === 'draft')
            .map((team) => team.id).sort();
          const activeTeamIds = new Set(plan.activateTeamIds);
          const activePersonIds = new Set(plan.activatePersonIds);
          const placementIds = graph.placements
            .filter((placement) => activePersonIds.has(placement.employeePersonId) &&
              (placement.teamId === null || activeTeamIds.has(placement.teamId)))
            .map((placement) => placement.id);

          await this.activateRows(tx, tenantId, unitId, graph, plan, placementIds);
          if (newlyActivatedPersonIds.length > 0) {
            await tx.insert(orgOnboardingDeliveries).values(newlyActivatedPersonIds.map((personId) => ({
              tenantId, personId, unitId, externalWorkspaceId: workspaceId,
            }))).onConflictDoNothing();
          }
          await tx.insert(auditLogs).values({
            tenantId, actorType: actor.type, actorId: actorId(actor), action: 'org.unit.rollout',
            resourceType: 'org_unit', resourceId: unitId,
            metadata: {
              workspaceId,
              affectedPersonIds: plan.activatePersonIds,
              affectedTeamIds: plan.activateTeamIds,
              newlyActivatedPersonIds,
              newlyActivatedTeamIds,
              pendingPersonIds: plan.pendingPersonIds,
              before: { unitLifecycleStatus: graph.unit.lifecycleStatus,
                persons: newlyActivatedPersonIds.map((id) => ({ id, lifecycleStatus: 'draft' })),
                teams: newlyActivatedTeamIds.map((id) => ({ id, lifecycleStatus: 'draft' })) },
              after: { unitLifecycleStatus: 'active',
                persons: newlyActivatedPersonIds.map((id) => ({ id, lifecycleStatus: 'active' })),
                teams: newlyActivatedTeamIds.map((id) => ({ id, lifecycleStatus: 'active' })) },
              activatedPersonCount: newlyActivatedPersonIds.length,
              activatedTeamCount: newlyActivatedTeamIds.length,
              pendingPersonCount: plan.pendingPersonIds.length,
            },
          });
          results.push({ unitId, activatedPersonIds: newlyActivatedPersonIds,
            activatedTeamIds: newlyActivatedTeamIds, pendingPersonIds: plan.pendingPersonIds,
            issues: plan.issues });
        }
        return results;
      }, { isolationLevel: 'serializable' }));
    } catch (error) {
      await this.db.client.insert(auditLogs).values({
        tenantId, actorType: actor.type, actorId: actorId(actor), action: 'org.unit.rollout.rejected',
        resourceType: 'org_unit_batch', resourceId: selectedIds.join(',') || 'empty_selection',
        reason: error instanceof HierarchyAuthorizationError ? 'unauthorized'
          : error instanceof HierarchyRolloutError ? error.code : 'persistence_error',
        metadata: { workspaceId, unitIds: selectedIds },
      });
      throw error;
    }
  }

  private selectedUnitIds(unitIds: string[]): string[] {
    if (unitIds.length === 0 || unitIds.length > 100 || new Set(unitIds).size !== unitIds.length) {
      throw new HierarchyRolloutError('invalid_unit_selection');
    }
    return [...unitIds].sort();
  }

  private async assertWorkspace(tx: Transaction, tenantId: string, workspaceId: string): Promise<void> {
    const [workspace] = await tx.select({ id: workspaceConnections.id }).from(workspaceConnections).where(and(
      eq(workspaceConnections.tenantId, tenantId),
      eq(workspaceConnections.channelType, 'slack'),
      eq(workspaceConnections.externalWorkspaceId, workspaceId),
      eq(workspaceConnections.status, 'active'),
    )).limit(1);
    if (!workspace) throw new HierarchyRolloutError('slack_workspace_not_found');
  }

  private async loadGraph(
    tx: Transaction, tenantId: string, unitId: string, workspaceId: string,
  ): Promise<UnitActivationGraph> {
    const [unit] = await tx.select().from(orgUnits)
      .where(and(eq(orgUnits.id, unitId), eq(orgUnits.tenantId, tenantId))).for('update').limit(1);
    if (!unit) throw new HierarchyRolloutError('unit_not_found');
    const teams = await tx.select().from(orgTeams)
      .where(and(eq(orgTeams.unitId, unitId), eq(orgTeams.tenantId, tenantId))).for('update');
    const placements = await tx.select().from(orgEmployeePlacements)
      .where(and(eq(orgEmployeePlacements.unitId, unitId), eq(orgEmployeePlacements.tenantId, tenantId))).for('update');
    const assignments = await tx.select({
      id: orgAdvisorAssignments.id, advisorPersonId: orgAdvisorAssignments.advisorPersonId,
    }).from(orgAdvisorAssignments).where(and(
      eq(orgAdvisorAssignments.tenantId, tenantId), eq(orgAdvisorAssignments.unitId, unitId),
      ne(orgAdvisorAssignments.lifecycleStatus, 'inactive'),
    )).for('update');
    const hrbpScopes = await tx.select({
      personId: orgHrbpScopes.personId, scopeMode: orgHrbpScopes.scopeMode,
    }).from(orgHrbpScopes).where(and(
      eq(orgHrbpScopes.tenantId, tenantId), ne(orgHrbpScopes.lifecycleStatus, 'inactive'),
    )).for('update');
    const leadership = await tx.select({ id: people.id }).from(people).where(and(
      eq(people.tenantId, tenantId), eq(people.primaryRole, 'leadership'),
      ne(people.lifecycleStatus, 'inactive'),
    )).for('update');
    const personIds = [...new Set([
      unit.managerPersonId,
      ...teams.map((team) => team.teamLeadPersonId),
      ...placements.map((placement) => placement.employeePersonId),
      ...assignments.map((assignment) => assignment.advisorPersonId),
      ...hrbpScopes.filter((scope) => scope.scopeMode === 'all_units').map((scope) => scope.personId),
      ...leadership.map((person) => person.id),
    ].filter((id): id is string => Boolean(id)))];
    const personRows = personIds.length > 0
      ? await tx.select().from(people).where(and(
        eq(people.tenantId, tenantId), inArray(people.id, personIds),
      )).for('update') : [];
    const userRows = personIds.length > 0
      ? await tx.select({ id: users.id, status: users.status, deletedAt: users.deletedAt })
        .from(users).where(and(eq(users.tenantId, tenantId), inArray(users.id, personIds))).for('update') : [];
    const links = personIds.length > 0
      ? await tx.select({ userId: channelAccounts.userId }).from(channelAccounts).where(and(
        eq(channelAccounts.tenantId, tenantId),
        eq(channelAccounts.channelType, 'slack'),
        eq(channelAccounts.linkStatus, 'linked'),
        eq(channelAccounts.externalWorkspaceId, workspaceId),
        inArray(channelAccounts.userId, personIds),
      )) : [];
    const linkedIds = new Set(links.map((link) => link.userId));
    const usersById = new Map(userRows.map((user) => [user.id, user]));
    const scopeById = new Map(hrbpScopes.map((scope) => [scope.personId, scope.scopeMode]));
    const personById = new Map(personRows.map((person) => [person.id, person]));
    const scopedPeople = new Map<string, { id: string; role: 'hr' | 'hrbp' | 'leadership'; assignmentId?: string }>();
    for (const assignment of assignments) {
      const person = personById.get(assignment.advisorPersonId);
      if (person?.primaryRole === 'hr' || person?.primaryRole === 'hrbp' &&
          scopeById.get(person.id) === 'selected_units') {
        scopedPeople.set(person.id, { id: person.id, role: person.primaryRole, assignmentId: assignment.id });
      }
    }
    for (const scope of hrbpScopes) {
      if (scope.scopeMode === 'all_units' && personById.get(scope.personId)?.primaryRole === 'hrbp') {
        scopedPeople.set(scope.personId, { id: scope.personId, role: 'hrbp' });
      }
    }
    for (const person of leadership) {
      scopedPeople.set(person.id, { id: person.id, role: 'leadership' });
    }
    return {
      unit: {
        id: unit.id, tenantId: unit.tenantId,
        lifecycleStatus: unit.lifecycleStatus as LifecycleStatus,
        managerPersonId: unit.managerPersonId,
      },
      teams: teams.map((team) => ({
        id: team.id, tenantId: team.tenantId, unitId: team.unitId,
        lifecycleStatus: team.lifecycleStatus as LifecycleStatus,
        teamLeadPersonId: team.teamLeadPersonId,
      })),
      placements: placements.map((placement) => ({
        id: placement.id, tenantId: placement.tenantId, unitId: placement.unitId,
        teamId: placement.teamId, employeePersonId: placement.employeePersonId,
        lifecycleStatus: placement.lifecycleStatus as LifecycleStatus,
      })),
      scopedPeople: [...scopedPeople.values()],
      people: personRows.map((person) => ({
        id: person.id, tenantId: person.tenantId, primaryRole: person.primaryRole as PrimaryOrgRole,
        lifecycleStatus: person.lifecycleStatus as LifecycleStatus,
        slackLinked: linkedIds.has(person.id) && usersById.get(person.id)?.deletedAt === null &&
          ['active', 'inactive'].includes(usersById.get(person.id)?.status ?? ''),
      })),
    };
  }

  private async activateRows(
    tx: Transaction, tenantId: string, unitId: string, graph: UnitActivationGraph,
    plan: UnitActivationPlan, placementIds: string[],
  ): Promise<void> {
    if (plan.activatePersonIds.length > 0) {
      await tx.update(users).set({ status: 'active', updatedAt: new Date() }).where(and(
        eq(users.tenantId, tenantId), inArray(users.id, plan.activatePersonIds),
      ));
      await tx.update(people).set({ lifecycleStatus: 'active', updatedAt: new Date() }).where(and(
        eq(people.tenantId, tenantId), inArray(people.id, plan.activatePersonIds),
      ));
    }
    if (plan.activateTeamIds.length > 0) {
      await tx.update(orgTeams).set({ lifecycleStatus: 'active', updatedAt: new Date() }).where(and(
        eq(orgTeams.tenantId, tenantId), eq(orgTeams.unitId, unitId), inArray(orgTeams.id, plan.activateTeamIds),
      ));
    }
    if (placementIds.length > 0) {
      await tx.update(orgEmployeePlacements).set({ lifecycleStatus: 'active', updatedAt: new Date() }).where(and(
        eq(orgEmployeePlacements.tenantId, tenantId), eq(orgEmployeePlacements.unitId, unitId),
        inArray(orgEmployeePlacements.id, placementIds),
      ));
    }
    const activeScoped = (graph.scopedPeople ?? []).filter((person) =>
      plan.activatePersonIds.includes(person.id));
    const assignmentIds = activeScoped.flatMap((person) => person.assignmentId ? [person.assignmentId] : []);
    if (assignmentIds.length > 0) {
      await tx.update(orgAdvisorAssignments).set({ lifecycleStatus: 'active' }).where(and(
        eq(orgAdvisorAssignments.tenantId, tenantId), eq(orgAdvisorAssignments.unitId, unitId),
        inArray(orgAdvisorAssignments.id, assignmentIds),
      ));
    }
    const activeHrbpIds = activeScoped.filter((person) => person.role === 'hrbp').map((person) => person.id);
    if (activeHrbpIds.length > 0) {
      await tx.update(orgHrbpScopes).set({ lifecycleStatus: 'active' }).where(and(
        eq(orgHrbpScopes.tenantId, tenantId), inArray(orgHrbpScopes.personId, activeHrbpIds),
      ));
    }
    await tx.update(orgUnits).set({ lifecycleStatus: 'active', updatedAt: new Date() }).where(and(
      eq(orgUnits.id, unitId), eq(orgUnits.tenantId, tenantId),
    ));
  }
}
