import { describe, expect, it } from 'vitest';
import { resolvePulseReportFinalSchedule } from './resolve-pulse-report-final-schedule';
const calendar = {
  timezone: 'Europe/Warsaw',
  workingDays: [1, 2, 3, 4, 5],
  workStart: '09:00',
  workEnd: '18:00',
  holidays: [],
  dateOverrides: [],
};
const run = (start = '2026-10-19T00:00:00Z', end = '2026-10-26T00:00:00Z', extra = {}) =>
  resolvePulseReportFinalSchedule({
    periodStart: start,
    periodEnd: end,
    calendar: { ...calendar, ...extra },
  });
describe('company final deadline', () => {
  it('uses Friday company close and holidays rather than cycle end', () => {
    expect(run()).toMatchObject({ status: 'scheduled', finalDueAt: '2026-10-23T16:00:00.000Z' });
    expect(run(undefined, undefined, { holidays: ['2026-10-23'] })).toMatchObject({
      finalDueAt: '2026-10-22T16:00:00.000Z',
    });
  });
  it('uses weekend override and partial-end preceding day', () => {
    expect(
      run(undefined, undefined, {
        dateOverrides: [
          { date: '2026-10-24', kind: 'working', workStart: '09:00', workEnd: '13:00' },
        ],
      }),
    ).toMatchObject({ finalDueAt: '2026-10-24T11:00:00.000Z' });
    expect(run(undefined, '2026-10-23T10:00:00Z')).toMatchObject({
      finalDueAt: '2026-10-22T16:00:00.000Z',
    });
  });
  it('preserves exact microsecond boundary inclusion', () => {
    expect(run('2026-10-23T15:59:59.999999Z', '2026-10-23T16:00:00Z')).toMatchObject({
      status: 'scheduled',
    });
    expect(run('2026-10-23T16:00:00Z', '2026-10-23T16:00:00.000001Z')).toMatchObject({
      reason: 'no_working_close_in_cycle',
    });
  });
  it.each([
    ['2026-03-29', 'nonexistent_work_end'],
    ['2026-10-25', 'ambiguous_work_end'],
  ])('rejects selected DST %s', (date, reason) =>
    expect(
      run(`${date}T00:00:00Z`, `${date}T23:00:00Z`, {
        workingDays: [7],
        workStart: '00:00',
        workEnd: '02:30',
      }),
    ).toMatchObject({ reason }),
  );
  it('rejects one-in-range fold and skips outside gap', () => {
    expect(
      run('2026-10-25T00:45:00Z', '2026-10-25T02:00:00Z', {
        workingDays: [7],
        workStart: '00:00',
        workEnd: '02:30',
      }),
    ).toMatchObject({ reason: 'ambiguous_work_end' });
    expect(
      run('2026-03-28T00:00:00Z', '2026-03-29T00:30:00Z', {
        workingDays: [6, 7],
        workStart: '00:00',
        workEnd: '02:30',
      }),
    ).toMatchObject({ finalDueAt: '2026-03-28T01:30:00.000Z' });
  });
  it('ignores earlier gap once later eligible close exists', () =>
    expect(
      run('2026-03-28T00:00:00Z', '2026-03-31T00:00:00Z', {
        workingDays: [1, 7],
        workStart: '00:00',
        workEnd: '02:30',
      }),
    ).toMatchObject({ finalDueAt: '2026-03-30T00:30:00.000Z' }));
  it('searches beyond seven days', () =>
    expect(
      run('2026-10-01T00:00:00Z', '2026-10-26T00:00:00Z', {
        holidays: Array.from({ length: 16 }, (_, i) => `2026-10-${10 + i}`),
      }),
    ).toMatchObject({ finalDueAt: '2026-10-09T16:00:00.000Z' }));
  it('supports non-hour offsets and early Gregorian years', () => {
    expect(run(undefined, undefined, { timezone: 'Asia/Kathmandu' })).toMatchObject({
      finalDueAt: '2026-10-23T12:15:00.000Z',
    });
    for (const year of ['0001', '0099', '0100'])
      expect(
        run(`${year}-01-01T00:00:00Z`, `${year}-01-08T00:00:00Z`, {
          timezone: 'UTC',
          workingDays: [1, 2, 3, 4, 5, 6, 7],
        }),
      ).toMatchObject({ finalDueAt: `${year}-01-07T18:00:00.000Z` });
  });
});

describe('supported extreme boundaries', () => {
  it('resolves the last Gregorian day without sampling an invalid extended year', () =>
    expect(
      run('9999-12-30T00:00:00Z', '9999-12-31T23:59:59Z', {
        timezone: 'UTC',
        workingDays: [1, 2, 3, 4, 5, 6, 7],
      }),
    ).toMatchObject({ finalDueAt: '9999-12-31T18:00:00.000Z' }));
  it('rejects overprecise public bounds', () =>
    expect(run('2026-10-23T15:59:59.9999999Z', '2026-10-23T16:00:00Z')).toMatchObject({
      reason: 'invalid_cycle',
    }));
});

describe('company-local Gregorian edges', () => {
  it('retains eligible closes when the first company-local date is in the BCE era', () => {
    expect(
      run('0001-01-01T00:00:00Z', '0001-01-08T00:00:00Z', {
        timezone: 'Etc/GMT+1',
        workingDays: [1, 2, 3, 4, 5, 6, 7],
      }),
    ).toMatchObject({
      status: 'scheduled',
      localDate: '0001-01-07',
      finalDueAt: '0001-01-07T19:00:00.000Z',
    });
  });
  it('limits local enumeration to year 9999 when the company boundary crosses into year 10000', () => {
    expect(
      run('9999-12-30T00:00:00Z', '9999-12-31T23:00:00Z', {
        timezone: 'Pacific/Kiritimati',
        workingDays: [1, 2, 3, 4, 5, 6, 7],
      }),
    ).toMatchObject({
      status: 'scheduled',
      localDate: '9999-12-31',
      finalDueAt: '9999-12-31T04:00:00.000Z',
    });
  });
});

it.each([
  ['0001-01-01T00:00:00Z', '0001-01-01T00:30:00Z', 'Etc/GMT+1'],
  ['9999-12-31T10:00:00Z', '9999-12-31T23:00:00Z', 'Pacific/Kiritimati'],
])(
  'does not invent a close when the entire local interval lies outside supported dates (%s)',
  (start, end, timezone) => {
    expect(run(start, end, { timezone, workingDays: [1, 2, 3, 4, 5, 6, 7] })).toMatchObject({
      status: 'blocked',
      reason: 'no_working_close_in_cycle',
    });
  },
);
