import { describe, it, expect } from 'vitest';
import { isInQuietHours, getLocalHour, DEFAULT_QUIET_HOURS, type QuietHours } from './quiet-hours';

const at = (iso: string) => new Date(iso);

describe('isInQuietHours default window', () => {
  it('exports a 22–08 default window', () => {
    expect(DEFAULT_QUIET_HOURS).toEqual({ enabled: true, startHour: 22, endHour: 8 });
  });

  it('does not apply quiet hours when the user has disabled them', () => {
    // At 03:00 UTC, UTC user would be inside the 22-08 default window.
    const now = at('2026-08-02T03:00:00Z');
    expect(isInQuietHours(now, 'UTC', { enabled: false })).toBe(false);
    expect(isInQuietHours(now, 'UTC', { enabled: false } as QuietHours)).toBe(false);
  });

  it('applies the default window when quiet hours are enabled without a custom window', () => {
    expect(isInQuietHours(at('2026-08-02T03:00:00Z'), 'UTC', { enabled: true })).toBe(true);
  });

  it('is not quiet at midday under the default window', () => {
    expect(isInQuietHours(at('2026-08-02T12:00:00Z'), 'UTC', { enabled: false })).toBe(false);
    expect(isInQuietHours(at('2026-08-02T12:00:00Z'), 'UTC', { enabled: true })).toBe(false);
  });

  it('respects an explicit user window', () => {
    expect(isInQuietHours(at('2026-08-02T12:00:00Z'), 'UTC', { enabled: true, startHour: 11, endHour: 13 })).toBe(true);
  });
});

describe('isInQuietHours at fixed instants', () => {
  it('cross-midnight window: quiet before and after midnight, not at the edges outside it', () => {
    const qh = { enabled: true, startHour: 22, endHour: 8 };
    expect(isInQuietHours(at('2026-01-05T23:30:00Z'), 'UTC', qh)).toBe(true);
    expect(isInQuietHours(at('2026-01-06T00:15:00Z'), 'UTC', qh)).toBe(true);
    expect(isInQuietHours(at('2026-01-06T07:59:00Z'), 'UTC', qh)).toBe(true);
    expect(isInQuietHours(at('2026-01-06T08:00:00Z'), 'UTC', qh)).toBe(false);
    expect(isInQuietHours(at('2026-01-05T21:59:00Z'), 'UTC', qh)).toBe(false);
    expect(isInQuietHours(at('2026-01-05T22:00:00Z'), 'UTC', qh)).toBe(true);
  });

  it('same-day window: quiet only between start (inclusive) and end (exclusive)', () => {
    const qh = { enabled: true, startHour: 9, endHour: 17 };
    expect(isInQuietHours(at('2026-01-05T08:59:00Z'), 'UTC', qh)).toBe(false);
    expect(isInQuietHours(at('2026-01-05T09:00:00Z'), 'UTC', qh)).toBe(true);
    expect(isInQuietHours(at('2026-01-05T16:59:00Z'), 'UTC', qh)).toBe(true);
    expect(isInQuietHours(at('2026-01-05T17:00:00Z'), 'UTC', qh)).toBe(false);
  });

  it('evaluates the instant in the user timezone', () => {
    // 23:30Z is 01:30 in Europe/Kyiv (UTC+2 in January) and 15:30 in America/Los_Angeles.
    const now = at('2026-01-05T23:30:00Z');
    expect(getLocalHour(now, 'Europe/Kyiv')).toBe(1);
    expect(getLocalHour(now, 'America/Los_Angeles')).toBe(15);
    expect(isInQuietHours(now, 'America/Los_Angeles', { enabled: true })).toBe(false);
    expect(isInQuietHours(now, 'Europe/Kyiv', { enabled: true })).toBe(true);
  });
});
