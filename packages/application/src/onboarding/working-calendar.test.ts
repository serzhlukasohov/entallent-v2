import { describe, expect, it } from 'vitest';
import { nextWorkingTime, reminderDueAt } from './working-calendar';

const cal = { timezone: 'Europe/Kyiv', workingDays: [1, 2, 3, 4, 5], workStart: '09:00', workEnd: '18:00' };
const tz = 'Europe/Kyiv';

describe('reminderDueAt (answers Q12)', () => {
  it('Monday 15:00 delivery -> Wednesday 15:00', () => {
    expect(reminderDueAt(new Date('2026-10-05T12:00:00Z'), cal, tz).toISOString()).toBe('2026-10-07T12:00:00.000Z');
  });
  it('Thursday 17:55 Later -> Monday 17:55', () => {
    expect(reminderDueAt(new Date('2026-10-08T14:55:00Z'), cal, tz).toISOString()).toBe('2026-10-12T14:55:00.000Z');
  });
  it('Saturday 12:00 delivery -> Tuesday 12:00 (origin day never counts)', () => {
    expect(reminderDueAt(new Date('2026-10-10T09:00:00Z'), cal, tz).toISOString()).toBe('2026-10-13T09:00:00.000Z');
  });
  it('origin after closing -> next working opening after the 2nd working date', () => {
    // Monday 20:00 local -> Wednesday 20:00 is outside hours -> Thursday 09:00
    expect(reminderDueAt(new Date('2026-10-05T17:00:00Z'), cal, tz).toISOString()).toBe('2026-10-08T06:00:00.000Z');
  });
  it('origin exactly at closing time counts as outside hours (end exclusive)', () => {
    // Monday 18:00 -> Wednesday 18:00 -> Thursday 09:00
    expect(reminderDueAt(new Date('2026-10-05T15:00:00Z'), cal, tz).toISOString()).toBe('2026-10-08T06:00:00.000Z');
  });
  it('keeps local wall time across the DST change', () => {
    // Friday 2026-10-23 15:00 (+03) -> Tuesday 2026-10-27 15:00 (+02)
    expect(reminderDueAt(new Date('2026-10-23T12:00:00Z'), cal, tz).toISOString()).toBe('2026-10-27T13:00:00.000Z');
  });
  it('the user timezone is applied independently of the calendar timezone', () => {
    // Lisbon user, Monday 15:00 Lisbon (+01) -> Wednesday 15:00 Lisbon
    expect(reminderDueAt(new Date('2026-10-05T14:00:00Z'), cal, 'Europe/Lisbon').toISOString()).toBe('2026-10-07T14:00:00.000Z');
  });
});

describe('nextWorkingTime', () => {
  it('returns the same instant inside working hours', () => {
    const at = new Date('2026-10-07T08:00:00Z'); // Wed 11:00 Kyiv
    expect(nextWorkingTime(at, cal, tz).toISOString()).toBe(at.toISOString());
  });
  it('moves an early-morning time to opening on the same day', () => {
    expect(nextWorkingTime(new Date('2026-10-07T03:00:00Z'), cal, tz).toISOString()).toBe('2026-10-07T06:00:00.000Z');
  });
  it('moves a weekend time to Monday opening', () => {
    expect(nextWorkingTime(new Date('2026-10-10T09:00:00Z'), cal, tz).toISOString()).toBe('2026-10-12T06:00:00.000Z');
  });
});
