import { describe, expect, it, vi } from 'vitest';
import { asc } from 'drizzle-orm';
import { onboardingStates } from '@entalent/database';
import { OnboardingReminderSweepService } from './onboarding-reminder-sweep.service';

function build(rows: unknown[]) {
  const limit = vi.fn().mockResolvedValue(rows);
  const orderBy = vi.fn(() => ({ limit }));
  const where = vi.fn(() => ({ orderBy }));
  const db = { client: { select: () => ({ from: () => ({ where }) }) } };
  const queue = { add: vi.fn().mockResolvedValue(undefined) };
  return { service: new OnboardingReminderSweepService(queue as never, db as never), queue, limit, orderBy };
}

describe('OnboardingReminderSweepService', () => {
  it('enqueues a sweep-specific id (hourly bucket) so a retained completed canonical job cannot dedupe it', async () => {
    const due = new Date('2026-10-07T09:00:00Z');
    const { service, queue, limit } = build([{ tenantId: 't1', personId: 'p1', reminderDueAt: due }]);
    const result = await service.sweep();
    expect(limit).toHaveBeenCalledWith(100);
    expect(queue.add).toHaveBeenCalledWith('remind', { tenantId: 't1', personId: 'p1', dueAt: due.toISOString() },
      { delay: 0, jobId: `onb-rem-sweep:p1:${due.getTime()}-${Math.floor(Date.now() / 3_600_000)}` });
    expect(result).toEqual({ found: 1, enqueued: 1, failed: 0 });
  });

  it('takes the oldest due reminders first', async () => {
    const { service, orderBy } = build([]);
    await service.sweep();
    expect(orderBy).toHaveBeenCalledWith(asc(onboardingStates.reminderDueAt));
  });

  it('a throwing row does not stop the next row', async () => {
    const d1 = new Date('2026-10-07T09:00:00Z');
    const d2 = new Date('2026-10-07T09:05:00Z');
    const { service, queue } = build([
      { tenantId: 't1', personId: 'p1', reminderDueAt: d1 }, { tenantId: 't1', personId: 'p2', reminderDueAt: d2 }]);
    queue.add.mockRejectedValueOnce(new Error('boom'));
    const result = await service.sweep();
    expect(queue.add).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ found: 2, enqueued: 1, failed: 1 });
  });
});
