import { describe, expect, it } from 'vitest';
import { shouldRequeueStaleActiveEntry } from './pulse-backlog.repository';

describe('shouldRequeueStaleActiveEntry', () => {
  it('requeues stale active probes when the user never replied', () => {
    expect(shouldRequeueStaleActiveEntry(false, 0)).toBe(true);
  });

  it('requeues stale active probes when an inbound reply produced no survey evidence', () => {
    expect(shouldRequeueStaleActiveEntry(true, 0)).toBe(true);
  });

  it('keeps stale active probes active when an inbound reply produced evidence', () => {
    expect(shouldRequeueStaleActiveEntry(true, 1)).toBe(false);
  });
});
