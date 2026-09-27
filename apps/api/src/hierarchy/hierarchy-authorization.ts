import { and, eq, ne } from 'drizzle-orm';
import { orgPersonCapabilities, people, type DbClient } from '@entalent/database';

type Transaction = Parameters<Parameters<DbClient['db']['transaction']>[0]>[0];

export type HierarchyActor =
  | { type: 'company_admin'; personId: string }
  | { type: 'internal_operator'; operatorId: string };

export class HierarchyAuthorizationError extends Error {
  constructor() {
    super('active Company Admin capability is required in this tenant');
    this.name = 'HierarchyAuthorizationError';
  }
}

export function actorId(actor: HierarchyActor): string {
  return actor.type === 'company_admin' ? actor.personId : actor.operatorId;
}

export async function assertHierarchyActorAuthorized(
  tx: Transaction, tenantId: string, actor: HierarchyActor,
): Promise<void> {
  if (actor.type === 'internal_operator') return;
  const authorized = await tx.select({ id: people.id })
    .from(people)
    .innerJoin(orgPersonCapabilities, and(
      eq(orgPersonCapabilities.personId, people.id),
      eq(orgPersonCapabilities.tenantId, people.tenantId),
    ))
    .where(and(
      eq(people.id, actor.personId), eq(people.tenantId, tenantId),
      ne(people.lifecycleStatus, 'inactive'),
      eq(orgPersonCapabilities.capability, 'company_admin'),
      eq(orgPersonCapabilities.lifecycleStatus, 'active'),
    )).limit(1);
  if (authorized.length === 0) throw new HierarchyAuthorizationError();
}
