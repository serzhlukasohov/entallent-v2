import { and, eq, inArray, sql } from 'drizzle-orm';
import { auditLogs, conversations, messages, orgOnboardingDeliveries, tenants, type DbClient } from '@entalent/database';

type Transaction = Parameters<Parameters<DbClient['db']['transaction']>[0]>[0];

export type OnboardingReconciliationRow = {
  deliveryId: string;
  personId: string;
  lastAttemptAt: string | null;
  outcome: 'db_receipt_ready' | 'manual_slack_verification_required';
  externalMessageId: string | null;
};

export async function reconcileSendingOnboarding(
  db: DbClient['db'], tenantId: string, options: { apply: boolean; operatorId?: string },
): Promise<{ tenantId: string; mode: 'dry_run' | 'applied'; rows: OnboardingReconciliationRow[]; applied: number }> {
  return db.transaction(async (tx) => {
    if (!options.apply) await tx.execute(sql`SET TRANSACTION READ ONLY`);
    if (options.apply && !options.operatorId?.trim()) throw new Error('operator_id_required');
    const [tenant] = await tx.select({ id: tenants.id }).from(tenants)
      .where(eq(tenants.id, tenantId)).limit(1);
    if (!tenant) throw new Error('tenant_missing');
    const scope = and(eq(orgOnboardingDeliveries.tenantId, tenantId),
      eq(orgOnboardingDeliveries.status, 'sending'));
    const deliveries = options.apply
      ? await tx.select().from(orgOnboardingDeliveries).where(scope).for('update')
      : await tx.select().from(orgOnboardingDeliveries).where(scope);
    if (deliveries.length === 0) return { tenantId, mode: options.apply ? 'applied' : 'dry_run', rows: [], applied: 0 };
    const receipts = await readReceipts(tx, tenantId, deliveries.map((row) => row.id));
    const byId = new Map(receipts.map((row) => [row.messageId, row]));
    let applied = 0;
    const rows: OnboardingReconciliationRow[] = [];
    for (const delivery of deliveries) {
      const receipt = byId.get(delivery.id);
      const sentAt = receipt?.sentAt;
      const externalMessageId = receipt?.externalMessageId;
      const ready = receipt?.personId === delivery.personId &&
        receipt.direction === 'outbound' && receipt.senderType === 'agent' &&
        receipt.channelType === 'slack' && receipt.conversationPersonId === delivery.personId &&
        receipt.deletedAt === null && hasOnboardingMarker(receipt.metadata, delivery.id) &&
        sentAt instanceof Date && typeof externalMessageId === 'string' &&
        /^\d+\.\d+$/.test(externalMessageId);
      rows.push({ deliveryId: delivery.id, personId: delivery.personId,
        lastAttemptAt: delivery.lastAttemptAt?.toISOString() ?? null,
        outcome: ready ? 'db_receipt_ready' : 'manual_slack_verification_required',
        externalMessageId: ready ? externalMessageId : null });
      if (!ready || !options.apply || !sentAt || !externalMessageId) continue;
      const [updated] = await tx.update(orgOnboardingDeliveries).set({
        status: 'delivered', deliveredAt: sentAt, externalMessageId,
        updatedAt: new Date(),
      }).where(and(eq(orgOnboardingDeliveries.id, delivery.id),
        eq(orgOnboardingDeliveries.tenantId, tenantId), eq(orgOnboardingDeliveries.status, 'sending')))
        .returning({ id: orgOnboardingDeliveries.id });
      if (!updated) throw new Error('onboarding_reconciliation_stale');
      await tx.insert(auditLogs).values({ tenantId, actorType: 'internal_operator',
        actorId: options.operatorId!, action: 'org.onboarding.reconcile_db_receipt',
        resourceType: 'org_onboarding_delivery', resourceId: delivery.id,
        metadata: { externalMessageId, sentAt: sentAt.toISOString() } });
      applied++;
    }
    return { tenantId, mode: options.apply ? 'applied' : 'dry_run', rows, applied };
  }, { isolationLevel: options.apply ? 'serializable' : 'repeatable read' });
}

function hasOnboardingMarker(metadata: unknown, deliveryId: string): boolean {
  return typeof metadata === 'object' && metadata !== null && !Array.isArray(metadata) &&
    (metadata as Record<string, unknown>)['onboardingDeliveryId'] === deliveryId;
}

async function readReceipts(tx: Transaction, tenantId: string, deliveryIds: string[]) {
  return tx.select({
    messageId: messages.id, personId: messages.userId,
    direction: messages.direction, senderType: messages.senderType,
    metadata: messages.metadata, deletedAt: messages.deletedAt,
    sentAt: messages.sentAt, externalMessageId: messages.externalMessageId,
    channelType: conversations.channelType, conversationPersonId: conversations.userId,
  }).from(messages).innerJoin(conversations, and(eq(conversations.id, messages.conversationId),
    eq(conversations.tenantId, messages.tenantId)))
    .where(and(eq(messages.tenantId, tenantId), inArray(messages.id, deliveryIds)));
}
