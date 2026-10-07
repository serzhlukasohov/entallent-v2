import { describe, expect, it, vi } from 'vitest';
import { auditLogs, tenantWorkCalendars } from '@entalent/database';
import { CompanyCalendarError, CompanyCalendarService } from './company-calendar.service';

const tenantId = 'tenant-1';
const valid = { timezone: 'Europe/Kyiv', workingDays: [5, 1, 2, 3, 4], workStart: '09:00', workEnd: '18:00' };

function setup(existing?: Record<string, unknown>) {
  const inserts: Array<{ table: unknown; value: unknown; conflict?: unknown }> = [];
  const order: string[] = [];
  const tx = {
    select: () => ({ from: () => ({ where: () => ({ for: async () => (existing ? [existing] : []),
      then: (resolve: (v: unknown[]) => unknown) => Promise.resolve(existing ? [existing] : []).then(resolve) }) }) }),
    insert: (table: unknown) => ({ values: (value: unknown) => {
      const entry: { table: unknown; value: unknown; conflict?: unknown } = { table, value };
      inserts.push(entry);
      order.push(table === auditLogs ? 'audit' : 'upsert');
      return { onConflictDoUpdate: async (conflict: unknown) => { entry.conflict = conflict; } , then: (r: (v: unknown) => unknown) => Promise.resolve(undefined).then(r) };
    } }),
  };
  const client = {
    transaction: async (run: (t: typeof tx) => Promise<unknown>) => run(tx),
    select: () => ({ from: () => ({ where: async () => (existing ? [existing] : []) }) }),
  };
  const recalculator = { recalculateScheduledReminders: vi.fn(async () => { order.push('recalc'); }) };
  const service = new CompanyCalendarService({ client } as never, recalculator);
  return { service, inserts, order, recalculator };
}

describe('CompanyCalendarService', () => {
  it('returns null when not configured and the calendar when configured', async () => {
    await expect(setup().service.get(tenantId)).resolves.toBeNull();
    await expect(setup({ tenantId, ...valid, onboardingLanguage: 'en', updatedBy: 'x' }).service.get(tenantId))
      .resolves.toEqual(valid);
  });

  it('rejects an invalid calendar', async () => {
    const { service, inserts } = setup();
    await expect(service.configure(tenantId, { ...valid, workingDays: [] }, 'op@entalent'))
      .rejects.toMatchObject({ code: 'invalid_calendar' });
    expect(inserts).toEqual([]);
  });

  it('requires an operator', async () => {
    const { service } = setup();
    await expect(service.configure(tenantId, valid, '  ')).rejects.toBeInstanceOf(CompanyCalendarError);
    await expect(service.configure(tenantId, valid, '')).rejects.toMatchObject({ code: 'operator_required' });
  });

  it('upserts and audits in one transaction, then recalculates reminders', async () => {
    const before = { tenantId, ...valid, workEnd: '17:00', onboardingLanguage: 'en', updatedBy: 'old' };
    const { service, inserts, order, recalculator } = setup(before);
    const { calendar: stored, recalculation } = await service.configure(tenantId, valid, 'op@entalent');
    expect(recalculation).toBe('queued');
    expect(stored).toEqual({ ...valid, workingDays: [1, 2, 3, 4, 5] });
    expect(inserts[0]).toMatchObject({ table: tenantWorkCalendars, value: expect.objectContaining({ tenantId, updatedBy: 'op@entalent' }) });
    expect(inserts[1]).toMatchObject({ table: auditLogs, value: {
      tenantId, actorType: 'internal_operator', actorId: 'op@entalent', action: 'org.work_calendar.configure',
      resourceType: 'tenant', resourceId: tenantId, metadata: { before, after: stored } } });
    expect(order).toEqual(['upsert', 'audit', 'recalc']);
    expect(recalculator.recalculateScheduledReminders).toHaveBeenCalledWith(tenantId);
  });

  it('works without a recalculator', async () => {
    const service = new CompanyCalendarService({ client: { transaction: async (run: (t: unknown) => unknown) => run({
      select: () => ({ from: () => ({ where: () => ({ for: async () => [] }) }) }),
      insert: () => ({ values: () => ({ onConflictDoUpdate: async () => undefined, then: (r: (v: unknown) => unknown) => Promise.resolve().then(r) }) }),
    }) } } as never);
    await expect(service.configure(tenantId, valid, 'op')).resolves.toMatchObject({ recalculation: 'skipped' });
  });

  it('a recalculator failure after commit is reported, not thrown', async () => {
    const { service, recalculator } = setup();
    recalculator.recalculateScheduledReminders.mockRejectedValueOnce(new Error('redis down'));
    await expect(service.configure(tenantId, valid, 'op')).resolves.toMatchObject({ recalculation: 'failed' });
  });
});
