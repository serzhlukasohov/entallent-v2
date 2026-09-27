import { Injectable } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import { auditLogs, orgAdvisorAssignments, orgHrbpScopes, orgUnits, people } from '@entalent/database';
import { DatabaseService } from '../database/database.service';
import { actorId, assertHierarchyActorAuthorized, HierarchyAuthorizationError, type HierarchyActor } from './hierarchy-authorization';
import { withSerializableRetry } from './serializable-retry';

export class HierarchyAdvisorScopeError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'HierarchyAdvisorScopeError';
  }
}

type ScopeMode = 'all_units' | 'selected_units';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable()
export class HierarchyAdvisorScopeService {
  constructor(private readonly db: DatabaseService) {}

  async replaceScope(
    tenantId: string, personId: string, input: { scopeMode?: unknown; unitIds?: unknown }, actor: HierarchyActor,
  ) {
    try {
      return await withSerializableRetry(() => this.db.client.transaction(async (tx) => {
        await assertHierarchyActorAuthorized(tx, tenantId, actor);
        const [person] = await tx.select({ role: people.primaryRole, lifecycle: people.lifecycleStatus })
          .from(people).where(and(eq(people.id, personId), eq(people.tenantId, tenantId)))
          .for('update').limit(1);
        if (!person || person.lifecycle === 'inactive' || !['hr', 'hrbp'].includes(person.role)) {
          throw new HierarchyAdvisorScopeError('eligible_advisor_required');
        }
        const mode: ScopeMode = person.role === 'hr' ? 'selected_units' : input.scopeMode as ScopeMode;
        if (input.scopeMode !== undefined && input.scopeMode !== mode ||
            !['all_units', 'selected_units'].includes(mode)) {
          throw new HierarchyAdvisorScopeError('scope_mode_invalid');
        }
        if (!Array.isArray(input.unitIds) || input.unitIds.length > 500 ||
            input.unitIds.some((id) => typeof id !== 'string' || !UUID.test(id))) {
          throw new HierarchyAdvisorScopeError('unit_ids_invalid');
        }
        const unitIds = [...new Set(input.unitIds as string[])].sort();
        if (unitIds.length !== input.unitIds.length) throw new HierarchyAdvisorScopeError('duplicate_unit_id');
        if (mode === 'all_units' && unitIds.length > 0) {
          throw new HierarchyAdvisorScopeError('all_units_must_not_list_units');
        }
        if (mode === 'selected_units' && person.lifecycle === 'active' && unitIds.length === 0) {
          throw new HierarchyAdvisorScopeError('selected_units_required');
        }
        const selectedUnits = unitIds.length === 0 ? [] : await tx.select({
          id: orgUnits.id, lifecycle: orgUnits.lifecycleStatus,
        }).from(orgUnits).where(and(eq(orgUnits.tenantId, tenantId), inArray(orgUnits.id, unitIds))).for('share');
        if (selectedUnits.length !== unitIds.length || selectedUnits.some((unit) =>
          unit.lifecycle === 'inactive' || person.lifecycle === 'active' && unit.lifecycle !== 'active')) {
          throw new HierarchyAdvisorScopeError('eligible_units_required');
        }
        const existing = await tx.select({
          id: orgAdvisorAssignments.id, unitId: orgAdvisorAssignments.unitId,
          lifecycle: orgAdvisorAssignments.lifecycleStatus,
        }).from(orgAdvisorAssignments).where(and(
          eq(orgAdvisorAssignments.tenantId, tenantId), eq(orgAdvisorAssignments.advisorPersonId, personId),
        )).for('update');
        const beforeUnitIds = existing.filter((row) => row.lifecycle !== 'inactive').map((row) => row.unitId).sort();
        const beforeMode = person.role === 'hrbp' ? (await tx.select({
          mode: orgHrbpScopes.scopeMode, lifecycle: orgHrbpScopes.lifecycleStatus,
        }).from(orgHrbpScopes).where(and(eq(orgHrbpScopes.tenantId, tenantId),
          eq(orgHrbpScopes.personId, personId))).for('update').limit(1))[0] : null;
        const targetStatus = person.lifecycle === 'active' ? 'active' : 'draft';
        const scopeStatus = person.lifecycle === 'draft' && mode === 'selected_units' && unitIds.length === 0
          ? 'inactive' : targetStatus;
        for (const row of existing) {
          const desired = unitIds.includes(row.unitId) ? targetStatus : 'inactive';
          if (row.lifecycle !== desired) await tx.update(orgAdvisorAssignments)
            .set({ lifecycleStatus: desired }).where(and(
              eq(orgAdvisorAssignments.id, row.id), eq(orgAdvisorAssignments.tenantId, tenantId),
            ));
        }
        const existingIds = new Set(existing.map((row) => row.unitId));
        const added = unitIds.filter((id) => !existingIds.has(id));
        if (added.length > 0) await tx.insert(orgAdvisorAssignments).values(added.map((unitId) => ({
          tenantId, advisorPersonId: personId, unitId, lifecycleStatus: targetStatus,
        })));
        if (person.role === 'hrbp') {
          await tx.insert(orgHrbpScopes).values({
            personId, tenantId, scopeMode: mode, lifecycleStatus: scopeStatus,
          }).onConflictDoUpdate({ target: orgHrbpScopes.personId,
            set: { scopeMode: mode, lifecycleStatus: scopeStatus } });
        }
        await tx.insert(auditLogs).values({
          tenantId, actorType: actor.type, actorId: actorId(actor),
          action: 'org.advisor_scope.replace', resourceType: 'person', resourceId: personId,
          metadata: { before: { scopeMode: beforeMode?.mode ?? null, unitIds: beforeUnitIds },
            after: { scopeMode: mode, unitIds } },
        });
        return { personId, scopeMode: mode, unitIds, lifecycleStatus: scopeStatus };
      }, { isolationLevel: 'serializable' }));
    } catch (error) {
      await this.db.client.insert(auditLogs).values({
        tenantId, actorType: actor.type, actorId: actorId(actor),
        action: 'org.advisor_scope.replace.rejected', resourceType: 'person', resourceId: personId,
        reason: error instanceof HierarchyAuthorizationError ? 'unauthorized'
          : error instanceof HierarchyAdvisorScopeError ? error.code : 'persistence_error',
      });
      throw error;
    }
  }
}
