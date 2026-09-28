import { Injectable } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import { planEmployeeMove, planManagerPromotion, planTeamLeadPromotion, type ActiveGraphIssue, type ActiveHierarchyGraph, type PreviousManagerAction, type PreviousTeamLeadAction } from '@entalent/application';
import { auditLogs, orgEmployeePlacements, orgOnboardingDeliveries, orgTeams, orgUnits, people, users } from '@entalent/database';
import { DatabaseService } from '../database/database.service';
import { actorId, assertHierarchyActorAuthorized, HierarchyAuthorizationError, type HierarchyActor } from './hierarchy-authorization';
import { withSerializableRetry } from './serializable-retry';

export class HierarchyMutationError extends Error {
  constructor(readonly code: string, readonly issues: ActiveGraphIssue[] = []) {
    super(code);
    this.name = 'HierarchyMutationError';
  }
}

@Injectable()
export class HierarchyMutationService {
  constructor(private readonly db: DatabaseService) {}

  async promoteManager(
    tenantId: string, unitId: string, employeePersonId: string,
    previousManagerAction: PreviousManagerAction, actor: HierarchyActor,
  ) {
    try {
      return await withSerializableRetry(() => this.db.client.transaction(async (tx) => {
        await assertHierarchyActorAuthorized(tx, tenantId, actor);
        const graph: ActiveHierarchyGraph = {
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
        const plan = planManagerPromotion(graph, unitId, employeePersonId, previousManagerAction);
        if (!plan.ok) throw new HierarchyMutationError('manager_promotion_invalid', plan.issues);
        const now = new Date();
        const [placement] = await tx.update(orgEmployeePlacements)
          .set({ lifecycleStatus: 'inactive', updatedAt: now })
          .where(and(eq(orgEmployeePlacements.id, plan.promotedPlacementId),
            eq(orgEmployeePlacements.tenantId, tenantId), eq(orgEmployeePlacements.lifecycleStatus, 'active')))
          .returning({ id: orgEmployeePlacements.id });
        if (!placement) throw new HierarchyMutationError('manager_promotion_stale');
        if (previousManagerAction === 'become_employee') {
          await tx.insert(orgEmployeePlacements).values({
            tenantId, employeePersonId: plan.previousManagerPersonId,
            unitId, teamId: null, lifecycleStatus: 'active',
          });
        }
        const [newManager] = await tx.update(people)
          .set({ primaryRole: 'manager', pulseParticipant: false, updatedAt: now })
          .where(and(eq(people.id, employeePersonId), eq(people.tenantId, tenantId),
            eq(people.primaryRole, 'employee'), eq(people.lifecycleStatus, 'active')))
          .returning({ id: people.id });
        if (!newManager) throw new HierarchyMutationError('manager_promotion_stale');
        const [previousManager] = await tx.update(people)
          .set(previousManagerAction === 'become_employee'
            ? { primaryRole: 'employee', pulseParticipant: true, updatedAt: now }
            : { lifecycleStatus: 'inactive', updatedAt: now })
          .where(and(eq(people.id, plan.previousManagerPersonId), eq(people.tenantId, tenantId),
            eq(people.primaryRole, 'manager'), eq(people.lifecycleStatus, 'active')))
          .returning({ id: people.id });
        if (!previousManager) throw new HierarchyMutationError('manager_promotion_stale');
        if (previousManagerAction === 'deactivate') {
          const [runtimeUser] = await tx.update(users).set({ status: 'inactive', updatedAt: now })
            .where(and(eq(users.id, plan.previousManagerPersonId), eq(users.tenantId, tenantId)))
            .returning({ id: users.id });
          if (!runtimeUser) throw new HierarchyMutationError('manager_promotion_stale');
          await tx.update(orgOnboardingDeliveries).set({ status: 'cancelled', updatedAt: now })
            .where(and(eq(orgOnboardingDeliveries.tenantId, tenantId),
              eq(orgOnboardingDeliveries.personId, plan.previousManagerPersonId),
              inArray(orgOnboardingDeliveries.status, ['pending', 'failed'])));
        }
        const [unit] = await tx.update(orgUnits).set({ managerPersonId: employeePersonId, updatedAt: now })
          .where(and(eq(orgUnits.id, unitId), eq(orgUnits.tenantId, tenantId),
            eq(orgUnits.managerPersonId, plan.previousManagerPersonId), eq(orgUnits.lifecycleStatus, 'active')))
          .returning({ id: orgUnits.id });
        if (!unit) throw new HierarchyMutationError('manager_promotion_stale');
        await tx.insert(auditLogs).values({
          tenantId, actorType: actor.type, actorId: actorId(actor),
          action: 'org.manager.promote', resourceType: 'unit', resourceId: unitId,
          metadata: { newManagerPersonId: employeePersonId,
            previousManagerPersonId: plan.previousManagerPersonId, previousManagerAction,
            before: { managerPersonId: plan.previousManagerPersonId,
              promotedPerson: { id: employeePersonId, primaryRole: 'employee', placementId: plan.promotedPlacementId },
              previousManager: { id: plan.previousManagerPersonId, primaryRole: 'manager', lifecycleStatus: 'active' } },
            after: { managerPersonId: employeePersonId,
              promotedPerson: { id: employeePersonId, primaryRole: 'manager' },
              previousManager: { id: plan.previousManagerPersonId,
                primaryRole: previousManagerAction === 'become_employee' ? 'employee' : 'manager',
                lifecycleStatus: previousManagerAction === 'deactivate' ? 'inactive' : 'active' } } },
        });
        return { unitId, newManagerPersonId: employeePersonId,
          previousManagerPersonId: plan.previousManagerPersonId, previousManagerAction };
      }, { isolationLevel: 'serializable' }));
    } catch (error) {
      await this.db.client.insert(auditLogs).values({
        tenantId, actorType: actor.type, actorId: actorId(actor),
        action: 'org.manager.promote.rejected', resourceType: 'unit', resourceId: unitId,
        reason: error instanceof HierarchyAuthorizationError ? 'unauthorized'
          : error instanceof HierarchyMutationError ? error.code : 'persistence_error',
        metadata: { employeePersonId, previousManagerAction,
          issues: error instanceof HierarchyMutationError ? error.issues : [] },
      });
      throw error;
    }
  }

  async promoteTeamLead(
    tenantId: string, teamId: string, employeePersonId: string,
    previousLeadAction: PreviousTeamLeadAction, actor: HierarchyActor,
  ) {
    try {
      return await withSerializableRetry(() => this.db.client.transaction(async (tx) => {
        await assertHierarchyActorAuthorized(tx, tenantId, actor);
        const graph: ActiveHierarchyGraph = {
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
        const plan = planTeamLeadPromotion(graph, teamId, employeePersonId, previousLeadAction);
        if (!plan.ok) throw new HierarchyMutationError('team_lead_promotion_invalid', plan.issues);
        const now = new Date();
        const [placement] = await tx.update(orgEmployeePlacements)
          .set({ lifecycleStatus: 'inactive', updatedAt: now })
          .where(and(eq(orgEmployeePlacements.id, plan.promotedPlacementId),
            eq(orgEmployeePlacements.tenantId, tenantId), eq(orgEmployeePlacements.lifecycleStatus, 'active')))
          .returning({ id: orgEmployeePlacements.id });
        if (!placement) throw new HierarchyMutationError('team_lead_promotion_stale');
        if (previousLeadAction === 'become_employee') {
          await tx.insert(orgEmployeePlacements).values({
            tenantId, employeePersonId: plan.previousLeadPersonId,
            unitId: plan.unitId, teamId: plan.teamId, lifecycleStatus: 'active',
          });
        }
        const [newLead] = await tx.update(people).set({ primaryRole: 'team_lead', updatedAt: now })
          .where(and(eq(people.id, employeePersonId), eq(people.tenantId, tenantId),
            eq(people.primaryRole, 'employee'), eq(people.lifecycleStatus, 'active')))
          .returning({ id: people.id });
        if (!newLead) throw new HierarchyMutationError('team_lead_promotion_stale');
        const [previousLead] = await tx.update(people).set(previousLeadAction === 'become_employee'
          ? { primaryRole: 'employee', updatedAt: now }
          : { lifecycleStatus: 'inactive', updatedAt: now })
          .where(and(eq(people.id, plan.previousLeadPersonId), eq(people.tenantId, tenantId),
            eq(people.primaryRole, 'team_lead'), eq(people.lifecycleStatus, 'active')))
          .returning({ id: people.id });
        if (!previousLead) throw new HierarchyMutationError('team_lead_promotion_stale');
        if (previousLeadAction === 'deactivate') {
          const [runtimeUser] = await tx.update(users).set({ status: 'inactive', updatedAt: now })
            .where(and(eq(users.id, plan.previousLeadPersonId), eq(users.tenantId, tenantId)))
            .returning({ id: users.id });
          if (!runtimeUser) throw new HierarchyMutationError('team_lead_promotion_stale');
          await tx.update(orgOnboardingDeliveries).set({ status: 'cancelled', updatedAt: now })
            .where(and(eq(orgOnboardingDeliveries.tenantId, tenantId),
              eq(orgOnboardingDeliveries.personId, plan.previousLeadPersonId),
              inArray(orgOnboardingDeliveries.status, ['pending', 'failed'])));
        }
        const [team] = await tx.update(orgTeams).set({ teamLeadPersonId: employeePersonId, updatedAt: now })
          .where(and(eq(orgTeams.id, teamId), eq(orgTeams.tenantId, tenantId),
            eq(orgTeams.teamLeadPersonId, plan.previousLeadPersonId), eq(orgTeams.lifecycleStatus, 'active')))
          .returning({ id: orgTeams.id });
        if (!team) throw new HierarchyMutationError('team_lead_promotion_stale');
        await tx.insert(auditLogs).values({
          tenantId, actorType: actor.type, actorId: actorId(actor),
          action: 'org.team_lead.promote', resourceType: 'team', resourceId: teamId,
          metadata: { newLeadPersonId: employeePersonId,
            previousLeadPersonId: plan.previousLeadPersonId, previousLeadAction,
            before: { teamLeadPersonId: plan.previousLeadPersonId,
              promotedPerson: { id: employeePersonId, primaryRole: 'employee', placementId: plan.promotedPlacementId },
              previousLead: { id: plan.previousLeadPersonId, primaryRole: 'team_lead', lifecycleStatus: 'active' } },
            after: { teamLeadPersonId: employeePersonId,
              promotedPerson: { id: employeePersonId, primaryRole: 'team_lead' },
              previousLead: { id: plan.previousLeadPersonId,
                primaryRole: previousLeadAction === 'become_employee' ? 'employee' : 'team_lead',
                lifecycleStatus: previousLeadAction === 'deactivate' ? 'inactive' : 'active' } } },
        });
        return { teamId, newLeadPersonId: employeePersonId,
          previousLeadPersonId: plan.previousLeadPersonId, previousLeadAction };
      }, { isolationLevel: 'serializable' }));
    } catch (error) {
      await this.db.client.insert(auditLogs).values({
        tenantId, actorType: actor.type, actorId: actorId(actor),
        action: 'org.team_lead.promote.rejected', resourceType: 'team', resourceId: teamId,
        reason: error instanceof HierarchyAuthorizationError ? 'unauthorized'
          : error instanceof HierarchyMutationError ? error.code : 'persistence_error',
        metadata: { employeePersonId, previousLeadAction,
          issues: error instanceof HierarchyMutationError ? error.issues : [] },
      });
      throw error;
    }
  }

  async moveEmployee(
    tenantId: string, employeePersonId: string, targetUnitId: string,
    targetTeamId: string | null, actor: HierarchyActor,
  ) {
    try {
      return await withSerializableRetry(() => this.db.client.transaction(async (tx) => {
        await assertHierarchyActorAuthorized(tx, tenantId, actor);
        const graph: ActiveHierarchyGraph = {
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
        const plan = planEmployeeMove(graph, employeePersonId, targetUnitId, targetTeamId);
        if (!plan.ok) throw new HierarchyMutationError('employee_move_invalid', plan.issues);
        const [updated] = await tx.update(orgEmployeePlacements).set({
          unitId: plan.after.unitId, teamId: plan.after.teamId, updatedAt: new Date(),
        }).where(and(eq(orgEmployeePlacements.id, plan.placementId),
          eq(orgEmployeePlacements.tenantId, tenantId),
          eq(orgEmployeePlacements.lifecycleStatus, 'active'))).returning({ id: orgEmployeePlacements.id });
        if (!updated) throw new HierarchyMutationError('employee_move_stale');
        await tx.insert(auditLogs).values({
          tenantId, actorType: actor.type, actorId: actorId(actor),
          action: 'org.employee.move', resourceType: 'person', resourceId: employeePersonId,
          metadata: { placementId: plan.placementId, before: plan.before, after: plan.after },
        });
        return { employeePersonId, placementId: plan.placementId, ...plan.after };
      }, { isolationLevel: 'serializable' }));
    } catch (error) {
      await this.db.client.insert(auditLogs).values({
        tenantId, actorType: actor.type, actorId: actorId(actor),
        action: 'org.employee.move.rejected', resourceType: 'person', resourceId: employeePersonId,
        reason: error instanceof HierarchyAuthorizationError ? 'unauthorized'
          : error instanceof HierarchyMutationError ? error.code : 'persistence_error',
        metadata: { targetUnitId, targetTeamId,
          issues: error instanceof HierarchyMutationError ? error.issues : [] },
      });
      throw error;
    }
  }
}
