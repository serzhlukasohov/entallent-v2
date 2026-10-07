import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { initialOnboardingState } from '@entalent/application';
import { createDbClient, onboardingStates, people, tenants, tenantWorkCalendars, users, type DbClient } from '@entalent/database';
import { OnboardingRoleReconcileService } from './onboarding-role-reconcile.service';
import { OnboardingStateRepository } from './onboarding-state.repository';
import { OnboardingService } from './onboarding.service';

const databaseUrl = process.env['DATABASE_URL'];
const localDatabase = databaseUrl && /^postgres(?:ql)?:\/\/(?:[^@]+@)?(?:127\.0\.0\.1|localhost):\d+\//.test(databaseUrl);

describe.skipIf(!localDatabase)('OnboardingRoleReconcileService against PostgreSQL', () => {
  const tenantId = randomUUID();
  const mismatched = randomUUID(); // stored employee track, now a manager
  const inSync = randomUUID();
  const inactive = randomUUID(); // mismatch but deactivated
  const toEmployee = randomUUID(); // stored management track, now an employee
  let client: DbClient;
  let service: OnboardingRoleReconcileService;
  const effects = {
    scheduleReminder: vi.fn().mockResolvedValue(undefined),
    replaceIntroActions: vi.fn().mockResolvedValue(undefined),
    sendAcknowledgement: vi.fn().mockResolvedValue(undefined),
    startConversation: vi.fn().mockResolvedValue(undefined),
    sendRoleIntro: vi.fn().mockResolvedValue(undefined),
  };

  beforeAll(async () => {
    client = createDbClient(databaseUrl!);
    const db = client.db;
    await db.insert(tenants).values({ id: tenantId, name: 'Role reconcile fixture' });
    const rows: Array<[string, string, string, string, 'active' | 'inactive']> = [
      [mismatched, 'employee', 'manager', 'a', 'active'],
      [inSync, 'employee', 'employee', 'b', 'active'],
      [inactive, 'employee', 'manager', 'c', 'inactive'],
      [toEmployee, 'manager', 'employee', 'd', 'active'],
    ];
    await db.insert(users).values(rows.map(([id, , , , status]) => ({ id, tenantId, status })));
    await db.insert(people).values(rows.map(([id, , role, key, status]) => ({
      id, tenantId, customerEmployeeId: `R-${key}`, workEmail: `${key}@reconcile.test`, displayName: key,
      primaryRole: role, pulseParticipant: role === 'employee', lifecycleStatus: status,
    })));
    await db.insert(onboardingStates).values(rows.map(([personId, storedRole]) => {
      const s = initialOnboardingState(storedRole as never);
      return { tenantId, personId, track: s.track, introStatus: s.introStatus, participation: s.participation };
    }));
    await db.insert(tenantWorkCalendars).values({ tenantId, timezone: 'Europe/Kyiv', workingDays: [1, 2, 3, 4, 5],
      workStart: '09:00', workEnd: '18:00', updatedBy: 'test' });
    service = new OnboardingRoleReconcileService({ client: db } as never,
      new OnboardingService(new OnboardingStateRepository({ client: db } as never), effects));
  });

  afterAll(async () => {
    if (client) {
      await client.db.delete(tenants).where(eq(tenants.id, tenantId));
      await client.sql.end();
    }
  });

  it('reconciles each active track mismatch once and then finds nothing', async () => {
    const first = await service.sweep(tenantId);
    expect(first).toEqual({ found: 2, reconciled: 2, failed: 0 });
    const tracks = Object.fromEntries((await client.db.select().from(onboardingStates)
      .where(eq(onboardingStates.tenantId, tenantId))).map((r) => [r.personId, r.track]));
    expect(tracks[mismatched]).toBe('management');
    expect(tracks[toEmployee]).toBe('employee');
    expect(tracks[inSync]).toBe('employee');
    expect(tracks[inactive]).toBe('employee'); // inactive people are left alone
    expect(effects.sendRoleIntro).toHaveBeenCalledWith(expect.objectContaining({ personId: mismatched, role: 'manager' }));
    expect(effects.sendRoleIntro).toHaveBeenCalledWith(expect.objectContaining({ personId: toEmployee, role: 'employee' }));

    const second = await service.sweep(tenantId);
    expect(second).toEqual({ found: 0, reconciled: 0, failed: 0 });
    expect(effects.sendRoleIntro).toHaveBeenCalledTimes(2);
  });
});
