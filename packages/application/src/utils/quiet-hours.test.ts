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

  it('does not apply quiet hours when the user has disabled them', () => {
    // At 03:00 UTC, UTC user would be inside the 22-08 default window.
    vi.setSystemTime(new Date('2026-08-02T03:00:00Z'));
    expect(isInQuietHours('UTC', { enabled: false })).toBe(false);
    expect(isInQuietHours('UTC', { enabled: false } as QuietHours)).toBe(false);
  });

  it('applies the default window when quiet hours are enabled without a custom window', () => {
    vi.setSystemTime(new Date('2026-08-02T03:00:00Z'));
    expect(isInQuietHours('UTC', { enabled: true })).toBe(true);
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
