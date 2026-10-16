import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import {
  createDbClient, onboardingStates, orgOnboardingDeliveries, orgUnits, people, tenants, users, type DbClient,
} from '@entalent/database';
import { OnboardingRestartService } from './onboarding-restart.service';

const databaseUrl = process.env['DATABASE_URL'];
const localDatabase = databaseUrl && /^postgres(?:ql)?:\/\/(?:[^@]+@)?(?:127\.0\.0\.1|localhost):\d+\//.test(databaseUrl);

describe.skipIf(!localDatabase)('OnboardingRestartService on migrated local PostgreSQL', () => {
  const tenantId = randomUUID();
  const workspaceId = 'T-restart-fixture';
  let client: DbClient;
  let service: OnboardingRestartService;
  let unitId: string;

  const seedPerson = async (role: 'employee' | 'manager') => {
    const personId = randomUUID();
    await client.db.insert(users).values({ id: personId, tenantId, status: 'active' });
    await client.db.insert(people).values({
      id: personId, tenantId, customerEmployeeId: `emp-${personId}`, workEmail: `${personId}@restart.test`,
      displayName: 'Restart Fixture', primaryRole: role, pulseParticipant: role === 'employee', lifecycleStatus: 'active',
    });
    return personId;
  };
  const stateOf = async (personId: string) => (await client.db.select().from(onboardingStates)
    .where(and(eq(onboardingStates.tenantId, tenantId), eq(onboardingStates.personId, personId))))[0];
  const deliveryOf = async (personId: string) => (await client.db.select().from(orgOnboardingDeliveries)
    .where(and(eq(orgOnboardingDeliveries.tenantId, tenantId), eq(orgOnboardingDeliveries.personId, personId))))[0];

  beforeAll(async () => {
    client = createDbClient(databaseUrl!);
    await client.db.insert(tenants).values({ id: tenantId, name: 'Onboarding restart fixture' });
    [{ id: unitId }] = await client.db.insert(orgUnits)
      .values({ tenantId, customerUnitKey: 'restart-unit', name: 'Restart Unit' }).returning({ id: orgUnits.id });
    service = new OnboardingRestartService({ client: client.db } as never);
  });

  afterAll(async () => {
    if (!client) return;
    await client.db.delete(tenants).where(eq(tenants.id, tenantId));
    await client.sql.end();
  });

  it('replaces a finished onboarding with a fresh state and a pending delivery for the same unit', async () => {
    const personId = await seedPerson('employee');
    await client.db.insert(onboardingStates).values({
      tenantId, personId, track: 'employee', introStatus: 'completed', participation: 'active',
      completedAt: new Date(), version: 3, buttonsActive: false,
    });
    const [oldDelivery] = await client.db.insert(orgOnboardingDeliveries).values({
      tenantId, personId, unitId, externalWorkspaceId: workspaceId, status: 'delivered',
      attemptCount: 1, deliveredAt: new Date(), externalMessageId: '1700000000.000100',
    }).returning({ id: orgOnboardingDeliveries.id });

    const result = await service.restart({ tenantId, personId });

    expect(result).toEqual({ stateDeleted: true, deliveryRequeued: true, unitId });
    const state = await stateOf(personId);
    expect(state).toMatchObject({
      track: 'employee', introStatus: 'pending', participation: 'undecided', completedAt: null,
      reminderStatus: 'none', buttonsActive: false,
    });
    // Version-keyed message ids must never collide with the earlier run.
    expect(state!.version).toBeGreaterThan(3);
    expect(state!.version).toBeGreaterThanOrEqual(Math.floor(Date.now() / 1000) - 60);
    const delivery = await deliveryOf(personId);
    expect(delivery).toMatchObject({
      unitId, externalWorkspaceId: workspaceId, status: 'pending', attemptCount: 0, deliveredAt: null, externalMessageId: null,
    });
    expect(delivery!.id).not.toBe(oldDelivery!.id);
  });

  it('maps a management role to a state without personal participation', async () => {
    const personId = await seedPerson('manager');
    await client.db.insert(onboardingStates).values({ tenantId, personId, track: 'management', participation: 'not_applicable' });
    await client.db.insert(orgOnboardingDeliveries).values({ tenantId, personId, unitId, externalWorkspaceId: workspaceId, status: 'delivered' });

    await service.restart({ tenantId, personId });

    expect(await stateOf(personId)).toMatchObject({ track: 'management', participation: 'not_applicable', introStatus: 'pending' });
  });

  it('clears the state but has nothing to requeue for a person who was never delivered to', async () => {
    const personId = await seedPerson('employee');
    await client.db.insert(onboardingStates).values({ tenantId, personId, track: 'employee', participation: 'declined' });

    const result = await service.restart({ tenantId, personId });

    expect(result).toEqual({ stateDeleted: true, deliveryRequeued: false, unitId: null });
    expect(await stateOf(personId)).toMatchObject({ participation: 'undecided', introStatus: 'pending' });
    expect(await deliveryOf(personId)).toBeUndefined();
  });

  it('reports when there was no onboarding state to delete', async () => {
    const personId = await seedPerson('employee');

    const result = await service.restart({ tenantId, personId });

    expect(result).toEqual({ stateDeleted: false, deliveryRequeued: false, unitId: null });
    expect(await stateOf(personId)).toMatchObject({ participation: 'undecided', introStatus: 'pending' });
  });

  it('rejects a person outside the requested tenant', async () => {
    const personId = await seedPerson('employee');

    await expect(service.restart({ tenantId: randomUUID(), personId })).rejects.toBeInstanceOf(NotFoundException);
    expect(await stateOf(personId)).toBeUndefined();
  });
});
