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

  it('a person whose single reminder was already sent is promoted to manager without a CHECK violation (Q8)', async () => {
    const t3 = randomUUID();
    const p = randomUUID();
    const db = client.db;
    await db.insert(tenants).values({ id: t3, name: 'Role sent-reminder fixture' });
    await db.insert(users).values({ id: p, tenantId: t3, status: 'active' });
    await db.insert(people).values({ id: p, tenantId: t3, customerEmployeeId: 'S-1', workEmail: 's1@sent.test',
      displayName: 's1', primaryRole: 'manager', pulseParticipant: false, lifecycleStatus: 'active' });
    await db.insert(onboardingStates).values({ tenantId: t3, personId: p, track: 'employee', introStatus: 'delivered',
      participation: 'undecided', reminderStatus: 'sent', reminderSentAt: new Date() });
    await db.insert(tenantWorkCalendars).values({ tenantId: t3, timezone: 'Europe/Kyiv', workingDays: [1, 2, 3, 4, 5],
      workStart: '09:00', workEnd: '18:00', updatedBy: 'test' });
    try {
      expect(await service.sweep(t3)).toEqual({ found: 1, reconciled: 1, failed: 0 });
      const [row] = await db.select().from(onboardingStates).where(eq(onboardingStates.personId, p));
      expect(row).toMatchObject({ track: 'management', participation: 'not_applicable', reminderStatus: 'none' });
    } finally {
      await db.delete(tenants).where(eq(tenants.id, t3));
    }
  });

  it('sweep then queued job: exactly one intro; job then sweep: exactly one intro', async () => {
    effects.sendRoleIntro.mockClear();
    const t2 = randomUUID();
    const a = randomUUID(); // sweep first
    const b = randomUUID(); // job first
    const db = client.db;
    await db.insert(tenants).values({ id: t2, name: 'Role race fixture' });
    await db.insert(users).values([a, b].map((id) => ({ id, tenantId: t2, status: 'active' })));
    await db.insert(people).values([a, b].map((id, i) => ({ id, tenantId: t2, customerEmployeeId: `X-${i}`,
      workEmail: `x${i}@race.test`, displayName: `x${i}`, primaryRole: 'manager', pulseParticipant: false, lifecycleStatus: 'active' })));
    await db.insert(onboardingStates).values([a, b].map((personId) => {
      const s = initialOnboardingState('employee');
      return { tenantId: t2, personId, track: s.track, introStatus: s.introStatus, participation: s.participation };
    }));
    await db.insert(tenantWorkCalendars).values({ tenantId: t2, timezone: 'Europe/Kyiv', workingDays: [1, 2, 3, 4, 5],
      workStart: '09:00', workEnd: '18:00', updatedBy: 'test' });
    const onboarding = new OnboardingService(new OnboardingStateRepository({ client: db } as never), effects);
    const job = (personId: string) => onboarding.apply(t2, personId,
      { type: 'role_changed', from: 'employee', to: 'manager', at: new Date() });
    try {
      // b: job first; a: sweep first, then the late job. The sweep must only see a.
      await job(b);
      expect(await service.sweep(t2)).toEqual({ found: 1, reconciled: 1, failed: 0 });
      expect((await job(a)).changed).toBe(false);
      expect(effects.sendRoleIntro.mock.calls.filter(([i]) => i.personId === a)).toHaveLength(1);
      expect(effects.sendRoleIntro.mock.calls.filter(([i]) => i.personId === b)).toHaveLength(1);
      expect(await service.sweep(t2)).toEqual({ found: 0, reconciled: 0, failed: 0 });
    } finally {
      await db.delete(tenants).where(eq(tenants.id, t2));
    }
  });
});
