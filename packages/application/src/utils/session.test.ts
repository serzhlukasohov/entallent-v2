import { describe, it, expect } from 'vitest';
import { isSessionStart, SESSION_GAP_HOURS } from './session';

const now = new Date('2026-08-02T12:00:00Z');
describe('isSessionStart', () => {
  it('true when there is no prior message', () => {
    expect(isSessionStart(undefined, now)).toBe(true);
  });
  it('true when the gap exceeds SESSION_GAP_HOURS', () => {
    const prior = new Date(now.getTime() - (SESSION_GAP_HOURS + 1) * 3600_000);
    expect(isSessionStart(prior, now)).toBe(true);
  });
  it('false within the gap', () => {
    const prior = new Date(now.getTime() - 60 * 60_000); // 1h ago
    expect(isSessionStart(prior, now)).toBe(false);
  });
});
