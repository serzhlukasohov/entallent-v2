import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { closeTestDb, describeIntegration, getTestDb, runMigrationsOnce } from './integration-setup';
import { onboardingStates, people, tenantWorkCalendars, tenants, users } from '../schema';

describeIntegration('onboarding schema', () => {
  const tenantId = randomUUID();
  const personId = randomUUID();
  beforeAll(async () => {
    await runMigrationsOnce();
    const { db } = getTestDb();
    await db.insert(tenants).values({ id: tenantId, name: 'onb' });
    await db.insert(users).values({ id: personId, tenantId });
    await db.insert(people).values({ id: personId, tenantId, customerEmployeeId: 'e1', workEmail: 'e1@x.io',
      displayName: 'E1', primaryRole: 'manager', pulseParticipant: false, lifecycleStatus: 'active' });
  });
  afterAll(async () => { await getTestDb().db.delete(tenants).where(eq(tenants.id, tenantId)); await closeTestDb(); });

  it('rejects a calendar with start after end', async () => {
    await expect(getTestDb().db.insert(tenantWorkCalendars).values({ tenantId, timezone: 'Europe/Kyiv',
      workingDays: [1], workStart: '18:00', workEnd: '09:00', updatedBy: 'op@entalent' })).rejects.toThrow();
  });
  it('rejects a management track with a participation value', async () => {
    await expect(getTestDb().db.insert(onboardingStates).values({ tenantId, personId, track: 'management',
      participation: 'active' })).rejects.toThrow();
  });
  it('rejects a scheduled reminder for management', async () => {
    await expect(getTestDb().db.insert(onboardingStates).values({ tenantId, personId, track: 'management',
      participation: 'not_applicable', reminderStatus: 'scheduled', reminderDueAt: new Date() })).rejects.toThrow();
  });
  it('allows one state row per person', async () => {
    const { db } = getTestDb();
    await db.insert(onboardingStates).values({ tenantId, personId, track: 'management', participation: 'not_applicable' });
    await expect(db.insert(onboardingStates).values({ tenantId, personId, track: 'management',
      participation: 'not_applicable' })).rejects.toThrow();
  });
});
