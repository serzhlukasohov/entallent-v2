import { describe, expect, it } from 'vitest';
import { onboardingStates, orgEmployeePlacements, orgUnits, tenantWorkCalendars } from '@entalent/database';
import { CompanySetupReadService } from './company-setup-read.service';

function service(calendar: Record<string, unknown> | null) {
  const client = { select: () => ({ from: (table: unknown) => ({
    where: async () => (table === tenantWorkCalendars && calendar ? [calendar] : []),
  }) }) };
  return new CompanySetupReadService({ client } as never);
}

describe('CompanySetupReadService calendar', () => {
  it('reports calendarConfigured=false when enTalent has not configured it', async () => {
    const snapshot = await service(null).snapshot('tenant-1');
    expect(snapshot.calendarConfigured).toBe(false);
    expect(snapshot.calendar).toBeNull();
  });
  it('exposes the calendar values read-only when configured', async () => {
    const calendar = { timezone: 'Europe/Kyiv', workingDays: [1, 2, 3, 4, 5], workStart: '09:00', workEnd: '18:00' };
    const snapshot = await service(calendar).snapshot('tenant-1');
    expect(snapshot.calendarConfigured).toBe(true);
    expect(snapshot.calendar).toEqual(calendar);
  });
});

function seeded(unitSize: number, states: string[], extra: Record<string, unknown[]> = {}) {
  const ids = Array.from({ length: unitSize }, (_, i) => `p${i}`);
  const rows = new Map<unknown, unknown[]>([
    [orgUnits, [{ id: 'u1', managerPersonId: 'mgr', lifecycleStatus: 'active', name: 'Sales' }]],
    [orgEmployeePlacements, ids.map((id) => ({ employeePersonId: id, unitId: 'u1', lifecycleStatus: 'active' }))],
    [onboardingStates, ids.map((id, i) => ({ personId: id, introStatus: states[i] ?? 'pending' }))],
  ]);
  const client = { select: () => ({ from: (table: unknown) => ({ where: async () => rows.get(table) ?? extra[String(table)] ?? [] }) }) };
  return new CompanySetupReadService({ client } as never);
}

function keys(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) value.forEach((v) => keys(v, out));
  else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) { out.push(k); keys(v, out); }
  return out;
}

describe('CompanySetupReadService onboardingSummary (Q20)', () => {
  it('suppresses a 3-person unit', async () => {
    const snapshot = await seeded(3, ['completed', 'delivered', 'pending']).snapshot('t');
    expect(snapshot.onboardingSummary).toEqual([{ unitId: 'u1', suppressed: true }]);
  });
  it('reports numbers for a 6-person unit and folds in-progress', async () => {
    const snapshot = await seeded(6, ['completed', 'completed', 'delivered', 'delivered', 'pending', 'pending']).snapshot('t');
    expect(snapshot.onboardingSummary).toEqual([{ unitId: 'u1', delivered: 4, completed: 2, inProgress: 2 }]);
  });
  it('exposes no participation decision key anywhere in the snapshot', async () => {
    const snapshot = await seeded(6, ['completed', 'delivered']).snapshot('t');
    const found = keys(JSON.parse(JSON.stringify(snapshot))).filter((k) => /participation|declined|deferred|optedout/i.test(k));
    expect(found).toEqual([]);
  });
});
