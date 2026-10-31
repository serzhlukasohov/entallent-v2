import { describe, expect, it } from 'vitest';
import {
  canonicalCompanyLocale,
  ReportCalendarMutationSchema,
  ReportCalendarSchema,
  ReportLocalDateSchema,
} from './pulse-report-calendar';
const base = {
  timezone: 'Europe/Warsaw',
  workingDays: [1, 2, 3, 4, 5],
  workStart: '09:00',
  workEnd: '18:00',
};
describe('report calendar contracts', () => {
  it('distinguishes omission from explicit clears', () => {
    expect(ReportCalendarMutationSchema.parse(base).holidays).toBeUndefined();
    expect(ReportCalendarMutationSchema.parse({ ...base, holidays: [] }).holidays).toEqual([]);
    expect(ReportCalendarSchema.parse(base).holidays).toEqual([]);
  });
  it.each(['2026-02-29', '0000-01-01', '2026-04-31', '2026-1-01'])(
    'rejects invalid date %s',
    (date) => expect(ReportLocalDateSchema.safeParse(date).success).toBe(false),
  );
  it.each(['0001-01-01', '0099-12-31', '0100-01-01', '2000-02-29'])(
    'accepts real date %s',
    (date) => expect(ReportLocalDateSchema.safeParse(date).success).toBe(true),
  );
  it('rejects duplicate weekdays, dates, contradictions and meaningless hours', () => {
    for (const patch of [
      { workingDays: [1, 1] },
      { timezone: 'no/zone' },
      { holidays: ['2026-10-23', '2026-10-23'] },
      { holidays: ['2026-10-23'], dateOverrides: [{ date: '2026-10-23', kind: 'closed' }] },
      { dateOverrides: [{ date: '2026-10-23', kind: 'closed', workEnd: '12:00' }] },
      {
        dateOverrides: [
          { date: '2026-10-23', kind: 'working', workStart: '18:00', workEnd: '09:00' },
        ],
      },
    ])
      expect(ReportCalendarSchema.safeParse({ ...base, ...patch }).success).toBe(false);
  });
  it('canonicalizes supported locale and rejects malformed explicit values', () => {
    expect(canonicalCompanyLocale(undefined)).toBe('en');
    expect(canonicalCompanyLocale('de-de')).toBe('de-DE');
    for (const value of ['', 'not_a_locale', 'zz-ZZ', 5])
      expect(canonicalCompanyLocale(value)).toBeNull();
  });
});
