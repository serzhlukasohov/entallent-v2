import { describe, expect, it } from 'vitest';
import { tenantWorkCalendars } from '@entalent/database';
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
