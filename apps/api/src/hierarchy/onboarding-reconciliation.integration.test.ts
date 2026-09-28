import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { auditLogs, conversations, createDbClient, messages, orgOnboardingDeliveries,
  orgUnits, people, tenants, users, type DbClient } from '@entalent/database';
import { reconcileSendingOnboarding, retryFailedOnboardingPreparation } from './onboarding-reconciliation';

const databaseUrl = process.env['DATABASE_URL'];
const localDatabase = databaseUrl && /^postgres(?:ql)?:\/\/(?:[^@]+@)?(?:127\.0\.0\.1|localhost):\d+\//.test(databaseUrl);

describe.skipIf(!localDatabase)('onboarding sending reconciliation on migrated local PostgreSQL', () => {
  const tenantId = randomUUID();
  const unitId = randomUUID();
  const readyPersonId = randomUUID();
  const uncertainPersonId = randomUUID();
  const readyDeliveryId = randomUUID();
  const uncertainDeliveryId = randomUUID();
  const readyConversationId = randomUUID();
  const uncertainConversationId = randomUUID();
  let client: DbClient;

  beforeAll(async () => {
    client = createDbClient(databaseUrl!);
    await client.db.insert(tenants).values({ id: tenantId, name: 'Sending reconciliation fixture' });
    await client.db.insert(users).values([readyPersonId, uncertainPersonId].map((id) => ({
      id, tenantId, status: 'active',
    })));
    await client.db.insert(people).values([readyPersonId, uncertainPersonId].map((id, index) => ({
      id, tenantId, customerEmployeeId: `E-${index}`, workEmail: `e${index}@fixture.test`,
      displayName: `Employee ${index}`, primaryRole: 'employee', pulseParticipant: true,
      lifecycleStatus: 'active',
    })));
    await client.db.insert(orgUnits).values({ id: unitId, tenantId, customerUnitKey: 'U-1', name: 'Unit' });
    await client.db.insert(orgOnboardingDeliveries).values([
      { id: readyDeliveryId, tenantId, personId: readyPersonId, unitId,
        externalWorkspaceId: 'T-fixture', status: 'sending', attemptCount: 1 },
      { id: uncertainDeliveryId, tenantId, personId: uncertainPersonId, unitId,
        externalWorkspaceId: 'T-fixture', status: 'sending', attemptCount: 1 },
    ]);
    await client.db.insert(conversations).values([
      { id: readyConversationId, tenantId, userId: readyPersonId,
        channelType: 'slack', externalConversationId: 'D-ready' },
      { id: uncertainConversationId, tenantId, userId: uncertainPersonId,
        channelType: 'slack', externalConversationId: 'D-uncertain' },
    ]);
    await client.db.insert(messages).values([
      { id: readyDeliveryId, tenantId, conversationId: readyConversationId,
        userId: readyPersonId, direction: 'outbound', senderType: 'agent', text: 'Welcome',
        occurredAt: new Date(), sentAt: new Date(), externalMessageId: '123.456',
        metadata: { onboardingDeliveryId: readyDeliveryId } },
      { id: uncertainDeliveryId, tenantId, conversationId: uncertainConversationId,
        userId: uncertainPersonId, direction: 'outbound', senderType: 'agent', text: 'Welcome',
        occurredAt: new Date(), metadata: { onboardingDeliveryId: uncertainDeliveryId } },
    ]);
  });

  afterAll(async () => {
    if (!client) return;
    await client.db.delete(tenants).where(eq(tenants.id, tenantId));
    await client.sql.end();
  });

  it('uses only durable receipt proof and leaves uncertain sends for Slack verification', async () => {
    const dry = await reconcileSendingOnboarding(client.db, tenantId, { apply: false });
    expect(dry.mode).toBe('dry_run');
    expect(dry.applied).toBe(0);
    expect(dry.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ deliveryId: readyDeliveryId, outcome: 'db_receipt_ready' }),
      expect.objectContaining({ deliveryId: uncertainDeliveryId,
        outcome: 'manual_slack_verification_required' }),
    ]));
    expect((await client.db.select().from(orgOnboardingDeliveries)
      .where(eq(orgOnboardingDeliveries.id, readyDeliveryId)))[0]?.status).toBe('sending');

    const applied = await reconcileSendingOnboarding(client.db, tenantId,
      { apply: true, operatorId: 'reconciliation-fixture' });
    expect(applied.applied).toBe(1);
    expect((await client.db.select().from(orgOnboardingDeliveries)
      .where(eq(orgOnboardingDeliveries.id, readyDeliveryId)))[0])
      .toMatchObject({ status: 'delivered', externalMessageId: '123.456' });
    expect((await client.db.select().from(orgOnboardingDeliveries)
      .where(eq(orgOnboardingDeliveries.id, uncertainDeliveryId)))[0]?.status).toBe('sending');
    expect((await client.db.select().from(auditLogs).where(eq(auditLogs.tenantId, tenantId)))
      .filter((row) => row.action === 'org.onboarding.reconcile_db_receipt')).toHaveLength(1);
    expect((await reconcileSendingOnboarding(client.db, tenantId,
      { apply: true, operatorId: 'reconciliation-fixture' })).applied).toBe(0);
  });
});

describe.skipIf(!localDatabase)('failed onboarding preparation retry on migrated local PostgreSQL', () => {
  const tenantId = randomUUID();
  const unitId = randomUUID();
  const personId = randomUUID();
  const deliveryId = randomUUID();
  let client: DbClient;

  beforeAll(async () => {
    client = createDbClient(databaseUrl!);
    await client.db.insert(tenants).values({ id: tenantId, name: 'Failed preparation fixture' });
    await client.db.insert(users).values({ id: personId, tenantId, status: 'active' });
    await client.db.insert(people).values({ id: personId, tenantId, customerEmployeeId: 'E-1',
      workEmail: 'retry@fixture.test', displayName: 'Retry Employee', primaryRole: 'employee',
      pulseParticipant: true, lifecycleStatus: 'active' });
    await client.db.insert(orgUnits).values({ id: unitId, tenantId, customerUnitKey: 'retry', name: 'Retry Unit' });
    await client.db.insert(orgOnboardingDeliveries).values({ id: deliveryId, tenantId, personId, unitId,
      externalWorkspaceId: 'T-fixture', status: 'failed', attemptCount: 1,
      lastAttemptAt: new Date() });
  });

  afterAll(async () => {
    if (!client) return;
    await client.db.delete(tenants).where(eq(tenants.id, tenantId));
    await client.sql.end();
  });

  it('requires no outbound message and resets only the exact failed intent with audit', async () => {
    const dry = await retryFailedOnboardingPreparation(client.db, tenantId, unitId, [personId],
      { apply: false });
    expect(dry).toMatchObject({ mode: 'dry_run', deliveryIds: [deliveryId], reset: 0 });
    const [conversation] = await client.db.insert(conversations).values({ tenantId, userId: personId,
      channelType: 'slack', externalConversationId: 'D-retry' }).returning({ id: conversations.id });
    await client.db.insert(messages).values({ id: deliveryId, tenantId, userId: personId,
      conversationId: conversation!.id, direction: 'outbound', senderType: 'agent',
      text: 'Uncertain first contact', occurredAt: new Date() });
    await expect(retryFailedOnboardingPreparation(client.db, tenantId, unitId, [personId],
      { apply: true, operatorId: 'retry-fixture' })).rejects.toThrow('outbound_message_requires_manual_reconciliation');
    expect((await client.db.select().from(orgOnboardingDeliveries)
      .where(eq(orgOnboardingDeliveries.id, deliveryId)))[0]?.status).toBe('failed');
    await client.db.delete(messages).where(eq(messages.id, deliveryId));

    const applied = await retryFailedOnboardingPreparation(client.db, tenantId, unitId, [personId],
      { apply: true, operatorId: 'retry-fixture' });
    expect(applied).toMatchObject({ mode: 'applied', deliveryIds: [deliveryId], reset: 1 });
    expect((await client.db.select().from(orgOnboardingDeliveries)
      .where(eq(orgOnboardingDeliveries.id, deliveryId)))[0]).toMatchObject({
        status: 'pending', attemptCount: 1, lastAttemptAt: null,
      });
    expect((await client.db.select().from(auditLogs).where(eq(auditLogs.tenantId, tenantId)))
      .filter((row) => row.action === 'org.onboarding.retry_failed_preparation')).toHaveLength(1);
    await expect(retryFailedOnboardingPreparation(client.db, tenantId, unitId, [personId],
      { apply: true, operatorId: 'retry-fixture' })).rejects.toThrow('failed_preparation_intents_changed');
  });
});
