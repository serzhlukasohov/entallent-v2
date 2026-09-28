import { Injectable } from '@nestjs/common';
import { and, eq, inArray, ne } from 'drizzle-orm';
import { planEmployeeDeactivation, planTeamDeactivation, planUnitTransferDeactivation, type ActiveGraphIssue, type ActiveHierarchyGraph, type PreviousManagerAction, type PreviousTeamLeadAction } from '@entalent/application';
import {
  auditLogs, orgAdvisorAssignments, orgEmployeePlacements, orgHrbpScopes,
  orgOnboardingDeliveries, orgTeams, orgUnits, people, users, type DbClient,
} from '@entalent/database';
import { DatabaseService } from '../database/database.service';
import { actorId, assertHierarchyActorAuthorized, HierarchyAuthorizationError, type HierarchyActor } from './hierarchy-authorization';
import { withSerializableRetry } from './serializable-retry';

type Transaction = Parameters<Parameters<DbClient['db']['transaction']>[0]>[0];

export class HierarchyDeactivationError extends Error {
  constructor(readonly code: string, readonly issues: ActiveGraphIssue[] = []) {
    super(code);
    this.name = 'HierarchyDeactivationError';
  }
}

@Injectable()
export class HierarchyDeactivationService {
  constructor(private readonly db: DatabaseService) {}

  private async loadGraph(tx: Transaction, tenantId: string): Promise<ActiveHierarchyGraph> {
    return {
      tenantId,
      people: await tx.select({
        id: people.id, tenantId: people.tenantId,
        primaryRole: people.primaryRole, lifecycleStatus: people.lifecycleStatus,
      }).from(people).where(eq(people.tenantId, tenantId)) as ActiveHierarchyGraph['people'],
      units: await tx.select({
        id: orgUnits.id, tenantId: orgUnits.tenantId,
        managerPersonId: orgUnits.managerPersonId, lifecycleStatus: orgUnits.lifecycleStatus,
      }).from(orgUnits).where(eq(orgUnits.tenantId, tenantId)),
      teams: await tx.select({
        id: orgTeams.id, tenantId: orgTeams.tenantId, unitId: orgTeams.unitId,
        teamLeadPersonId: orgTeams.teamLeadPersonId, lifecycleStatus: orgTeams.lifecycleStatus,
      }).from(orgTeams).where(eq(orgTeams.tenantId, tenantId)),
      placements: await tx.select({
        id: orgEmployeePlacements.id, tenantId: orgEmployeePlacements.tenantId,
        employeePersonId: orgEmployeePlacements.employeePersonId,
        unitId: orgEmployeePlacements.unitId, teamId: orgEmployeePlacements.teamId,
        lifecycleStatus: orgEmployeePlacements.lifecycleStatus,
      }).from(orgEmployeePlacements).where(eq(orgEmployeePlacements.tenantId, tenantId)),
    };
  }

  async deactivateTeam(
    tenantId: string, teamId: string, leadAction: PreviousTeamLeadAction, actor: HierarchyActor,
  ) {
    try {
      return await withSerializableRetry(() => this.db.client.transaction(async (tx) => {
        await assertHierarchyActorAuthorized(tx, tenantId, actor);
        const plan = planTeamDeactivation(await this.loadGraph(tx, tenantId), teamId, leadAction);
        if (!plan.ok) throw new HierarchyDeactivationError('team_deactivation_invalid', plan.issues);
        if (leadAction === 'deactivate' && actor.type === 'company_admin' && actor.personId === plan.leadPersonId) {
          throw new HierarchyDeactivationError('self_deactivation_forbidden');
        }
        const now = new Date();
        if (plan.placementIds.length > 0) {
          const moved = await tx.update(orgEmployeePlacements).set({ teamId: null, updatedAt: now })
            .where(and(eq(orgEmployeePlacements.tenantId, tenantId), eq(orgEmployeePlacements.teamId, teamId),
              inArray(orgEmployeePlacements.id, plan.placementIds)))
            .returning({ id: orgEmployeePlacements.id });
          if (moved.length !== plan.placementIds.length) throw new HierarchyDeactivationError('team_deactivation_stale');
        }
        if (leadAction === 'become_employee') {
          await tx.insert(orgEmployeePlacements).values({
            tenantId, employeePersonId: plan.leadPersonId,
            unitId: plan.unitId, teamId: null, lifecycleStatus: 'active',
          });
        }
        const [lead] = await tx.update(people).set(leadAction === 'become_employee'
          ? { primaryRole: 'employee', updatedAt: now }
          : { lifecycleStatus: 'inactive', updatedAt: now })
          .where(and(eq(people.id, plan.leadPersonId), eq(people.tenantId, tenantId),
            eq(people.primaryRole, 'team_lead'), eq(people.lifecycleStatus, 'active')))
          .returning({ id: people.id });
        if (!lead) throw new HierarchyDeactivationError('team_deactivation_stale');
        if (leadAction === 'deactivate') {
          const [runtimeUser] = await tx.update(users).set({ status: 'inactive', updatedAt: now })
            .where(and(eq(users.id, plan.leadPersonId), eq(users.tenantId, tenantId)))
            .returning({ id: users.id });
          if (!runtimeUser) throw new HierarchyDeactivationError('team_deactivation_stale');
          await tx.update(orgOnboardingDeliveries).set({ status: 'cancelled', updatedAt: now })
            .where(and(eq(orgOnboardingDeliveries.tenantId, tenantId),
              eq(orgOnboardingDeliveries.personId, plan.leadPersonId),
              inArray(orgOnboardingDeliveries.status, ['pending', 'failed'])));
        }
        const [team] = await tx.update(orgTeams).set({ lifecycleStatus: 'inactive', updatedAt: now })
          .where(and(eq(orgTeams.id, teamId), eq(orgTeams.tenantId, tenantId),
            eq(orgTeams.lifecycleStatus, 'active'), eq(orgTeams.teamLeadPersonId, plan.leadPersonId)))
          .returning({ id: orgTeams.id });
        if (!team) throw new HierarchyDeactivationError('team_deactivation_stale');
        await tx.insert(auditLogs).values({
          tenantId, actorType: actor.type, actorId: actorId(actor),
          action: 'org.team.deactivate', resourceType: 'org_team', resourceId: teamId,
          metadata: { unitId: plan.unitId, leadPersonId: plan.leadPersonId,
            leadAction, movedPlacementIds: plan.placementIds,
            before: { team: { id: teamId, lifecycleStatus: 'active', teamLeadPersonId: plan.leadPersonId },
              lead: { id: plan.leadPersonId, primaryRole: 'team_lead', lifecycleStatus: 'active' },
              placements: plan.placementIds.map((id) => ({ id, teamId })) },
            after: { team: { id: teamId, lifecycleStatus: 'inactive', teamLeadPersonId: plan.leadPersonId },
              lead: { id: plan.leadPersonId,
                primaryRole: leadAction === 'become_employee' ? 'employee' : 'team_lead',
                lifecycleStatus: leadAction === 'deactivate' ? 'inactive' : 'active' },
              leadPlacement: leadAction === 'become_employee' ? { unitId: plan.unitId, teamId: null } : null,
              placements: plan.placementIds.map((id) => ({ id, teamId: null })) } },
        });
        return { teamId, unitId: plan.unitId, leadPersonId: plan.leadPersonId,
          leadAction, movedPlacementIds: plan.placementIds };
      }, { isolationLevel: 'serializable' }));
    } catch (error) {
      await this.db.client.insert(auditLogs).values({
        tenantId, actorType: actor.type, actorId: actorId(actor),
        action: 'org.team.deactivate.rejected', resourceType: 'org_team', resourceId: teamId,
        reason: error instanceof HierarchyAuthorizationError ? 'unauthorized'
          : error instanceof HierarchyDeactivationError ? error.code : 'persistence_error',
        metadata: { leadAction, issues: error instanceof HierarchyDeactivationError ? error.issues : [] },
      });
      throw error;
    }
  }

  async transferAndDeactivateUnit(
    tenantId: string, sourceUnitId: string, targetUnitId: string,
    managerAction: PreviousManagerAction, actor: HierarchyActor,
  ) {
    try {
      return await withSerializableRetry(() => this.db.client.transaction(async (tx) => {
        await assertHierarchyActorAuthorized(tx, tenantId, actor);
        const plan = planUnitTransferDeactivation(
          await this.loadGraph(tx, tenantId), sourceUnitId, targetUnitId, managerAction,
        );
        if (!plan.ok) throw new HierarchyDeactivationError('unit_deactivation_invalid', plan.issues);
        if (managerAction === 'deactivate' && actor.type === 'company_admin' &&
            actor.personId === plan.managerPersonId) {
          throw new HierarchyDeactivationError('self_deactivation_forbidden');
        }
        const now = new Date();
        const teamPlacements = plan.placements.filter((placement) => placement.teamId !== null);
        const directPlacements = plan.placements.filter((placement) => placement.teamId === null);
        if (teamPlacements.length > 0) {
          const detached = await tx.update(orgEmployeePlacements)
            .set({ teamId: null, unitId: targetUnitId, updatedAt: now })
            .where(and(eq(orgEmployeePlacements.tenantId, tenantId),
              eq(orgEmployeePlacements.unitId, sourceUnitId),
              inArray(orgEmployeePlacements.id, teamPlacements.map((placement) => placement.id))))
            .returning({ id: orgEmployeePlacements.id });
          if (detached.length !== teamPlacements.length) throw new HierarchyDeactivationError('unit_deactivation_stale');
        }
        if (plan.teamIds.length > 0) {
          const movedTeams = await tx.update(orgTeams).set({ unitId: targetUnitId, updatedAt: now })
            .where(and(eq(orgTeams.tenantId, tenantId), eq(orgTeams.unitId, sourceUnitId),
              inArray(orgTeams.id, plan.teamIds)))
            .returning({ id: orgTeams.id });
          if (movedTeams.length !== plan.teamIds.length) throw new HierarchyDeactivationError('unit_deactivation_stale');
          for (const teamId of plan.teamIds) {
            const memberIds = teamPlacements.filter((placement) => placement.teamId === teamId)
              .map((placement) => placement.id);
            if (memberIds.length === 0) continue;
            const reattached = await tx.update(orgEmployeePlacements).set({ teamId, updatedAt: now })
              .where(and(eq(orgEmployeePlacements.tenantId, tenantId),
                eq(orgEmployeePlacements.unitId, targetUnitId),
                inArray(orgEmployeePlacements.id, memberIds)))
              .returning({ id: orgEmployeePlacements.id });
            if (reattached.length !== memberIds.length) throw new HierarchyDeactivationError('unit_deactivation_stale');
          }
        }
        if (directPlacements.length > 0) {
          const movedDirect = await tx.update(orgEmployeePlacements).set({ unitId: targetUnitId, updatedAt: now })
            .where(and(eq(orgEmployeePlacements.tenantId, tenantId),
              eq(orgEmployeePlacements.unitId, sourceUnitId),
              inArray(orgEmployeePlacements.id, directPlacements.map((placement) => placement.id))))
            .returning({ id: orgEmployeePlacements.id });
          if (movedDirect.length !== directPlacements.length) throw new HierarchyDeactivationError('unit_deactivation_stale');
        }
        const advisorAssignments = await tx.select({
          id: orgAdvisorAssignments.id, advisorPersonId: orgAdvisorAssignments.advisorPersonId,
          unitId: orgAdvisorAssignments.unitId, lifecycleStatus: orgAdvisorAssignments.lifecycleStatus,
        }).from(orgAdvisorAssignments).where(and(eq(orgAdvisorAssignments.tenantId, tenantId),
          inArray(orgAdvisorAssignments.unitId, [sourceUnitId, targetUnitId]))).for('update');
        for (const source of advisorAssignments.filter((row) => row.unitId === sourceUnitId &&
          row.lifecycleStatus !== 'inactive')) {
          const target = advisorAssignments.find((row) => row.unitId === targetUnitId &&
            row.advisorPersonId === source.advisorPersonId);
          if (target) {
            const status = source.lifecycleStatus === 'active' || target.lifecycleStatus === 'active'
              ? 'active' : 'draft';
            if (target.lifecycleStatus !== status) {
              await tx.update(orgAdvisorAssignments).set({ lifecycleStatus: status })
                .where(and(eq(orgAdvisorAssignments.id, target.id), eq(orgAdvisorAssignments.tenantId, tenantId)));
            }
            await tx.update(orgAdvisorAssignments).set({ lifecycleStatus: 'inactive' })
              .where(and(eq(orgAdvisorAssignments.id, source.id), eq(orgAdvisorAssignments.tenantId, tenantId)));
          } else {
            await tx.update(orgAdvisorAssignments).set({ unitId: targetUnitId })
              .where(and(eq(orgAdvisorAssignments.id, source.id), eq(orgAdvisorAssignments.tenantId, tenantId)));
          }
        }
        if (managerAction === 'become_employee') {
          await tx.insert(orgEmployeePlacements).values({
            tenantId, employeePersonId: plan.managerPersonId,
            unitId: targetUnitId, teamId: null, lifecycleStatus: 'active',
          });
        }
        const [manager] = await tx.update(people).set(managerAction === 'become_employee'
          ? { primaryRole: 'employee', pulseParticipant: true, updatedAt: now }
          : { lifecycleStatus: 'inactive', updatedAt: now })
          .where(and(eq(people.id, plan.managerPersonId), eq(people.tenantId, tenantId),
            eq(people.primaryRole, 'manager'), eq(people.lifecycleStatus, 'active')))
          .returning({ id: people.id });
        if (!manager) throw new HierarchyDeactivationError('unit_deactivation_stale');
        if (managerAction === 'deactivate') {
          const [runtimeUser] = await tx.update(users).set({ status: 'inactive', updatedAt: now })
            .where(and(eq(users.id, plan.managerPersonId), eq(users.tenantId, tenantId)))
            .returning({ id: users.id });
          if (!runtimeUser) throw new HierarchyDeactivationError('unit_deactivation_stale');
          await tx.update(orgOnboardingDeliveries).set({ status: 'cancelled', updatedAt: now })
            .where(and(eq(orgOnboardingDeliveries.tenantId, tenantId),
              eq(orgOnboardingDeliveries.personId, plan.managerPersonId),
              inArray(orgOnboardingDeliveries.status, ['pending', 'failed'])));
        }
        await tx.update(orgOnboardingDeliveries).set({ unitId: targetUnitId, updatedAt: now })
          .where(and(eq(orgOnboardingDeliveries.tenantId, tenantId),
            eq(orgOnboardingDeliveries.unitId, sourceUnitId),
            inArray(orgOnboardingDeliveries.status, ['pending', 'failed'])));
        const [unit] = await tx.update(orgUnits).set({ lifecycleStatus: 'inactive', updatedAt: now })
          .where(and(eq(orgUnits.id, sourceUnitId), eq(orgUnits.tenantId, tenantId),
            eq(orgUnits.lifecycleStatus, 'active'), eq(orgUnits.managerPersonId, plan.managerPersonId)))
          .returning({ id: orgUnits.id });
        if (!unit) throw new HierarchyDeactivationError('unit_deactivation_stale');
        await tx.insert(auditLogs).values({
          tenantId, actorType: actor.type, actorId: actorId(actor),
          action: 'org.unit.transfer_deactivate', resourceType: 'org_unit', resourceId: sourceUnitId,
          metadata: { targetUnitId, managerPersonId: plan.managerPersonId, managerAction,
            movedTeamIds: plan.teamIds, movedPlacementIds: plan.placements.map((row) => row.id),
            before: { unit: { id: sourceUnitId, lifecycleStatus: 'active', managerPersonId: plan.managerPersonId },
              manager: { id: plan.managerPersonId, primaryRole: 'manager', lifecycleStatus: 'active' },
              teams: plan.teamIds.map((id) => ({ id, unitId: sourceUnitId })),
              placements: plan.placements.map((row) => ({ id: row.id, unitId: sourceUnitId,
                teamId: row.teamId })) },
            after: { unit: { id: sourceUnitId, lifecycleStatus: 'inactive', managerPersonId: plan.managerPersonId },
              manager: { id: plan.managerPersonId,
                primaryRole: managerAction === 'become_employee' ? 'employee' : 'manager',
                lifecycleStatus: managerAction === 'deactivate' ? 'inactive' : 'active' },
              managerPlacement: managerAction === 'become_employee'
                ? { unitId: targetUnitId, teamId: null } : null,
              teams: plan.teamIds.map((id) => ({ id, unitId: targetUnitId })),
              placements: plan.placements.map((row) => ({ id: row.id, unitId: targetUnitId,
                teamId: row.teamId })) } },
        });
        return { sourceUnitId, targetUnitId, managerPersonId: plan.managerPersonId,
          managerAction, movedTeamIds: plan.teamIds,
          movedPlacementIds: plan.placements.map((row) => row.id) };
      }, { isolationLevel: 'serializable' }));
    } catch (error) {
      await this.db.client.insert(auditLogs).values({
        tenantId, actorType: actor.type, actorId: actorId(actor),
        action: 'org.unit.transfer_deactivate.rejected', resourceType: 'org_unit', resourceId: sourceUnitId,
        reason: error instanceof HierarchyAuthorizationError ? 'unauthorized'
          : error instanceof HierarchyDeactivationError ? error.code : 'persistence_error',
        metadata: { targetUnitId, managerAction,
          issues: error instanceof HierarchyDeactivationError ? error.issues : [] },
      });
      throw error;
    }
  }

  async deactivatePerson(tenantId: string, personId: string, actor: HierarchyActor) {
    try {
      return await withSerializableRetry(() => this.db.client.transaction(async (tx) => {
        await assertHierarchyActorAuthorized(tx, tenantId, actor);
        if (actor.type === 'company_admin' && actor.personId === personId) {
          throw new HierarchyDeactivationError('self_deactivation_forbidden');
        }
        const [person] = await tx.select({
          id: people.id, primaryRole: people.primaryRole, lifecycleStatus: people.lifecycleStatus,
        }).from(people).where(and(eq(people.id, personId), eq(people.tenantId, tenantId)))
          .for('update').limit(1);
        if (!person || person.lifecycleStatus !== 'active') {
          throw new HierarchyDeactivationError('active_person_required');
        }
        if (person.primaryRole === 'team_lead' || person.primaryRole === 'manager') {
          throw new HierarchyDeactivationError('owner_replacement_required');
        }
        let placementIds: string[] = [];
        if (person.primaryRole === 'employee' || person.primaryRole === 'leadership') {
          const graph = await this.loadGraph(tx, tenantId);
          if (person.primaryRole === 'employee') {
            const plan = planEmployeeDeactivation(graph, personId);
            if (!plan.ok) throw new HierarchyDeactivationError('employee_deactivation_invalid', plan.issues);
            placementIds = plan.placementIds;
          } else if (graph.units.some((unit) => unit.lifecycleStatus === 'active') &&
            graph.people.filter((row) => row.primaryRole === 'leadership' && row.lifecycleStatus === 'active').length <= 1) {
            throw new HierarchyDeactivationError('final_leadership_required');
          }
        }
        const now = new Date();
        if (placementIds.length > 0) {
          await tx.update(orgEmployeePlacements).set({ lifecycleStatus: 'inactive', updatedAt: now })
            .where(and(eq(orgEmployeePlacements.tenantId, tenantId), inArray(orgEmployeePlacements.id, placementIds)));
        }
        if (person.primaryRole === 'hr' || person.primaryRole === 'hrbp') {
          await tx.update(orgAdvisorAssignments).set({ lifecycleStatus: 'inactive' }).where(and(
            eq(orgAdvisorAssignments.tenantId, tenantId), eq(orgAdvisorAssignments.advisorPersonId, personId),
            ne(orgAdvisorAssignments.lifecycleStatus, 'inactive'),
          ));
          if (person.primaryRole === 'hrbp') {
            await tx.update(orgHrbpScopes).set({ lifecycleStatus: 'inactive' }).where(and(
              eq(orgHrbpScopes.tenantId, tenantId), eq(orgHrbpScopes.personId, personId),
              ne(orgHrbpScopes.lifecycleStatus, 'inactive'),
            ));
          }
        }
        const [updated] = await tx.update(people).set({ lifecycleStatus: 'inactive', updatedAt: now })
          .where(and(eq(people.id, personId), eq(people.tenantId, tenantId),
            eq(people.lifecycleStatus, 'active'))).returning({ id: people.id });
        if (!updated) throw new HierarchyDeactivationError('person_deactivation_stale');
        const [runtimeUser] = await tx.update(users).set({ status: 'inactive', updatedAt: now })
          .where(and(eq(users.id, personId), eq(users.tenantId, tenantId)))
          .returning({ id: users.id });
        if (!runtimeUser) throw new HierarchyDeactivationError('person_deactivation_stale');
        await tx.update(orgOnboardingDeliveries).set({ status: 'cancelled', updatedAt: now })
          .where(and(eq(orgOnboardingDeliveries.tenantId, tenantId), eq(orgOnboardingDeliveries.personId, personId),
            inArray(orgOnboardingDeliveries.status, ['pending', 'failed'])));
        await tx.insert(auditLogs).values({
          tenantId, actorType: actor.type, actorId: actorId(actor),
          action: 'org.person.deactivate', resourceType: 'person', resourceId: personId,
          metadata: { role: person.primaryRole, placementIds,
            before: { primaryRole: person.primaryRole, lifecycleStatus: 'active', activePlacementIds: placementIds },
            after: { primaryRole: person.primaryRole, lifecycleStatus: 'inactive', activePlacementIds: [] } },
        });
        return { personId, previousRole: person.primaryRole, lifecycleStatus: 'inactive' as const };
      }, { isolationLevel: 'serializable' }));
    } catch (error) {
      await this.db.client.insert(auditLogs).values({
        tenantId, actorType: actor.type, actorId: actorId(actor),
        action: 'org.person.deactivate.rejected', resourceType: 'person', resourceId: personId,
        reason: error instanceof HierarchyAuthorizationError ? 'unauthorized'
          : error instanceof HierarchyDeactivationError ? error.code : 'persistence_error',
        metadata: { issues: error instanceof HierarchyDeactivationError ? error.issues : [] },
      });
      throw error;
    }
  }
}
