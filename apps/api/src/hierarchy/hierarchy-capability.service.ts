import { Injectable } from '@nestjs/common';
import { and, eq, ne } from 'drizzle-orm';
import { auditLogs, orgPersonCapabilities, people, users } from '@entalent/database';
import { DatabaseService } from '../database/database.service';
import { actorId, assertHierarchyActorAuthorized, HierarchyAuthorizationError, type HierarchyActor } from './hierarchy-authorization';
import { withSerializableRetry } from './serializable-retry';

export class HierarchyCapabilityError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'HierarchyCapabilityError';
  }
}

@Injectable()
export class HierarchyCapabilityService {
  constructor(private readonly db: DatabaseService) {}

  async grantCompanyAdmin(tenantId: string, personId: string, actor: HierarchyActor) {
    return this.change(tenantId, personId, actor, 'active');
  }

  async revokeCompanyAdmin(tenantId: string, personId: string, actor: HierarchyActor) {
    if (actor.type === 'company_admin' && actor.personId === personId) {
      await this.auditRejected(tenantId, personId, actor, 'revoke', 'self_revoke_forbidden');
      throw new HierarchyCapabilityError('self_revoke_forbidden');
    }
    return this.change(tenantId, personId, actor, 'inactive');
  }

  private async change(
    tenantId: string, personId: string, actor: HierarchyActor, status: 'active' | 'inactive',
  ) {
    const operation = status === 'active' ? 'grant' : 'revoke';
    try {
      return await withSerializableRetry(() => this.db.client.transaction(async (tx) => {
        await assertHierarchyActorAuthorized(tx, tenantId, actor);
        const [person] = await tx.select({
          id: people.id, lifecycleStatus: people.lifecycleStatus,
          deletedAt: users.deletedAt,
        }).from(people).innerJoin(users, and(eq(users.id, people.id), eq(users.tenantId, people.tenantId)))
          .where(and(eq(people.id, personId), eq(people.tenantId, tenantId)))
          .for('update').limit(1);
        if (!person || person.lifecycleStatus === 'inactive' || person.deletedAt !== null) {
          throw new HierarchyCapabilityError('person_not_eligible');
        }
        const [existing] = await tx.select({ lifecycleStatus: orgPersonCapabilities.lifecycleStatus })
          .from(orgPersonCapabilities).where(and(
            eq(orgPersonCapabilities.tenantId, tenantId),
            eq(orgPersonCapabilities.personId, personId),
            eq(orgPersonCapabilities.capability, 'company_admin'),
          )).for('update').limit(1);
        if (status === 'inactive' && existing?.lifecycleStatus !== 'active') {
          throw new HierarchyCapabilityError('active_capability_not_found');
        }
        if (existing?.lifecycleStatus === status) {
          return { personId, capability: 'company_admin' as const, lifecycleStatus: status, changed: false };
        }
        if (existing) {
          await tx.update(orgPersonCapabilities).set({ lifecycleStatus: status }).where(and(
            eq(orgPersonCapabilities.tenantId, tenantId), eq(orgPersonCapabilities.personId, personId),
            eq(orgPersonCapabilities.capability, 'company_admin'),
            ne(orgPersonCapabilities.lifecycleStatus, status),
          ));
        } else {
          await tx.insert(orgPersonCapabilities).values({
            tenantId, personId, capability: 'company_admin', lifecycleStatus: status,
          });
        }
        await tx.insert(auditLogs).values({
          tenantId, actorType: actor.type, actorId: actorId(actor),
          action: `org.company_admin.${operation}`, resourceType: 'person', resourceId: personId,
          metadata: { before: existing
            ? { personId, capability: 'company_admin', lifecycleStatus: existing.lifecycleStatus } : null,
            after: { personId, capability: 'company_admin', lifecycleStatus: status } },
        });
        return { personId, capability: 'company_admin' as const, lifecycleStatus: status, changed: true };
      }, { isolationLevel: 'serializable' }));
    } catch (error) {
      await this.auditRejected(tenantId, personId, actor, operation,
        error instanceof HierarchyAuthorizationError ? 'unauthorized'
          : error instanceof HierarchyCapabilityError ? error.code : 'persistence_error');
      throw error;
    }
  }

  private async auditRejected(
    tenantId: string, personId: string, actor: HierarchyActor, operation: 'grant' | 'revoke', reason: string,
  ) {
    await this.db.client.insert(auditLogs).values({
      tenantId, actorType: actor.type, actorId: actorId(actor),
      action: `org.company_admin.${operation}.rejected`, resourceType: 'person', resourceId: personId,
      reason,
    });
  }
}
