import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { isInQuietHours, DEFAULT_QUIET_HOURS, type QuietHours } from './quiet-hours';

describe('isInQuietHours default window', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('exports a 22–08 default window', () => {
    expect(DEFAULT_QUIET_HOURS).toEqual({ enabled: true, startHour: 22, endHour: 8 });
  });

  it('applies the default window when the user has not enabled quiet hours', () => {
    // At 03:00 UTC, UTC user is inside 22–08 default.
    vi.setSystemTime(new Date('2026-08-02T03:00:00Z'));
    expect(isInQuietHours('UTC', { enabled: false })).toBe(true);   // default applied
    expect(isInQuietHours('UTC', { enabled: false } as QuietHours)).toBe(true);
  });

  it('is not quiet at midday under the default window', () => {
    vi.setSystemTime(new Date('2026-08-02T12:00:00Z'));
    expect(isInQuietHours('UTC', { enabled: false })).toBe(false);
  });

  it('respects an explicit user window', () => {
    vi.setSystemTime(new Date('2026-08-02T12:00:00Z'));
    expect(isInQuietHours('UTC', { enabled: true, startHour: 11, endHour: 13 })).toBe(true);
  });
});
