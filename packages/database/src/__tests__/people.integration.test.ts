import { afterAll, beforeAll, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { closeTestDb, describeIntegration, getTestDb, runMigrationsOnce } from './integration-setup';
import { people, tenants, users } from '../schema';

describeIntegration('Person registry constraints (integration)', () => {
  const tenantIds: string[] = [];

  beforeAll(async () => {
    await runMigrationsOnce();
  });

  afterAll(async () => {
    const { db } = getTestDb();
    for (const tenantId of tenantIds) {
      await db.delete(tenants).where(eq(tenants.id, tenantId));
    }
    await closeTestDb();
  });

  it('keeps legacy users without Person records and enforces tenant-scoped identity', async () => {
    const { db } = getTestDb();
    const [tenantA, tenantB] = await db.insert(tenants).values([{ name: 'People A' }, { name: 'People B' }]).returning();
    tenantIds.push(tenantA!.id, tenantB!.id);
    const [legacyUser, personUser, otherTenantUser] = await db.insert(users).values([
      { tenantId: tenantA!.id },
      { tenantId: tenantA!.id },
      { tenantId: tenantB!.id },
    ]).returning();

    expect(await db.select().from(people).where(eq(people.id, legacyUser!.id))).toEqual([]);

    const draft = {
      id: personUser!.id,
      tenantId: tenantA!.id,
      customerEmployeeId: 'EMP-001',
      workEmail: 'alex@example.com',
      displayName: 'Alex',
      primaryRole: 'employee',
      pulseParticipant: true,
    };
    const [created] = await db.insert(people).values(draft).returning();
    expect(created!.lifecycleStatus).toBe('draft');

    await expect(db.insert(people).values({
      ...draft,
      id: otherTenantUser!.id,
      customerEmployeeId: 'EMP-OTHER',
      workEmail: 'other@example.com',
    })).rejects.toThrow();
    await expect(db.insert(people).values({ ...draft, id: legacyUser!.id })).rejects.toThrow();
  });

  it('rejects an invalid role-to-Pulse combination', async () => {
    const { db } = getTestDb();
    const [tenant] = await db.insert(tenants).values({ name: 'People Roles' }).returning();
    tenantIds.push(tenant!.id);
    const [user] = await db.insert(users).values({ tenantId: tenant!.id }).returning();
    await expect(db.insert(people).values({
      id: user!.id,
      tenantId: tenant!.id,
      customerEmployeeId: 'M-001',
      workEmail: 'manager@example.com',
      displayName: 'Manager',
      primaryRole: 'manager',
      pulseParticipant: true,
    })).rejects.toThrow();
  });
});
