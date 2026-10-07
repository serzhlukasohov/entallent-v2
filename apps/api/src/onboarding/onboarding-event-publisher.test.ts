import { describe, expect, it, vi } from 'vitest';
import { OnboardingEventPublisher } from './onboarding-event-publisher';

describe('OnboardingEventPublisher', () => {
  it('enqueues one system job per event with a job id keyed by person and audit row', async () => {
    const queue = { add: vi.fn().mockResolvedValue(undefined) };
    await new OnboardingEventPublisher(queue as never).publish('t1', [
      { personId: 'p1', auditLogId: 'a1', event: { type: 'role_changed', from: 'manager', to: 'employee' } },
      { personId: 'p2', auditLogId: 'a1', event: { type: 'deactivated' } },
    ]);
    expect(queue.add).toHaveBeenNthCalledWith(1, 'system', {
      kind: 'system', tenantId: 't1', personId: 'p1', event: { type: 'role_changed', from: 'manager', to: 'employee' },
    }, { jobId: 'onb-sys:p1:a1' });
    expect(queue.add).toHaveBeenNthCalledWith(2, 'system', {
      kind: 'system', tenantId: 't1', personId: 'p2', event: { type: 'deactivated' },
    }, { jobId: 'onb-sys:p2:a1' });
  });

  it('logs and swallows a failed enqueue and still enqueues the rest', async () => {
    const queue = { add: vi.fn().mockRejectedValueOnce(new Error('redis down')).mockResolvedValue(undefined) };
    await expect(new OnboardingEventPublisher(queue as never).publish('t1', [
      { personId: 'p1', auditLogId: 'a1', event: { type: 'deactivated' } },
      { personId: 'p2', auditLogId: 'a1', event: { type: 'deactivated' } },
    ])).resolves.toBeUndefined();
    expect(queue.add).toHaveBeenCalledTimes(2);
  });
});
