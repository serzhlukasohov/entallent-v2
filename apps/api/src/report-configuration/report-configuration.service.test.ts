import { describe, expect, it, vi } from 'vitest';
import { ReportConfigurationService } from './report-configuration.service';
const calendar = {
  timezone: 'Europe/Warsaw',
  workingDays: [1, 2, 3, 4, 5],
  workStart: '09:00',
  workEnd: '18:00',
};
describe('report configuration caller validation', () => {
  it('rejects invalid calendar, operator and revision before opening a transaction', async () => {
    const transaction = vi.fn();
    const service = new ReportConfigurationService({ client: { transaction } } as never);
    await expect(
      service.saveCalendar('t', { ...calendar, holidays: ['2026-02-29'] }, 'op', 0),
    ).rejects.toMatchObject({ code: 'invalid_calendar' });
    await expect(service.saveCalendar('t', calendar, ' ', 0)).rejects.toMatchObject({
      code: 'operator_required',
    });
    await expect(service.saveCalendar('t', calendar, 'op', -1)).rejects.toMatchObject({
      code: 'invalid_revision',
    });
    expect(transaction).not.toHaveBeenCalled();
  });
  it('requires explicit supported language and an integer CAS revision', async () => {
    const transaction = vi.fn();
    const service = new ReportConfigurationService({ client: { transaction } } as never),
      actor = { type: 'internal_operator' as const, operatorId: 'op' };
    for (const locale of [undefined, null, '', 'zz-ZZ', 'bad_locale'])
      await expect(service.saveLanguage('t', locale, 0, actor)).rejects.toMatchObject({
        code: 'invalid_locale',
      });
    await expect(service.saveLanguage('t', 'de', 1.5, actor)).rejects.toMatchObject({
      code: 'invalid_revision',
    });
    expect(transaction).not.toHaveBeenCalled();
  });
});
