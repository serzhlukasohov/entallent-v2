import { describe, expect, it, vi } from 'vitest';
import { BullOnboardingReminderRecalculator } from './onboarding-reminder-recalculator';

describe('BullOnboardingReminderRecalculator', () => {
  it('adds a recalculate job for the tenant', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-07T10:00:00Z'));
    const queue = { add: vi.fn().mockResolvedValue(undefined) };
    await new BullOnboardingReminderRecalculator(queue as never).recalculateScheduledReminders('t1');
    expect(queue.add).toHaveBeenCalledWith('recalculate', { tenantId: 't1' },
      { jobId: `onb-recalc:t1:${Date.now()}` });
    vi.useRealTimers();
  });
});
