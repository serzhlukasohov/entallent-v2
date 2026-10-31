import { describe, it, expect, vi } from 'vitest';
import { PulseReportLifecycleProcessor } from './pulse-report-lifecycle.processor';
import { PulseReportLifecycleScheduler } from './pulse-report-lifecycle.scheduler';
describe('native lifecycle execution registration boundary', () => {
  it('default processor reads no database and invokes no formation or transport', async () => {
    const form = { execute: vi.fn() },
      delivery = { deliverNext: vi.fn() };
    const processor = new PulseReportLifecycleProcessor(
      {} as never,
      form as never,
      delivery as never,
    );
    expect(
      await processor.process({
        tenantId: 'tenant',
        obligationId: 'obligation',
        action: 'deliver',
      }),
    ).toEqual({ status: 'disabled' });
    expect(form.execute).not.toHaveBeenCalled();
    expect(delivery.deliverNext).not.toHaveBeenCalled();
  });
  it('default scheduler has no timer, queue or provider effect', async () => {
    const repository = { discover: vi.fn() },
      queue = { add: vi.fn() };
    expect(await new PulseReportLifecycleScheduler(repository as never, queue).runOnce()).toEqual({
      status: 'disabled',
      observed: 0,
      queued: 0,
    });
    expect(repository.discover).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
  });
  it('database repair survives lost enqueue and one blocked scope without erasing obligations', async () => {
    const repository = {
      discover: vi.fn(async () => [{}, {}]),
      observe: vi.fn().mockRejectedValueOnce(Error('blocked')).mockResolvedValue({}),
      repair: vi.fn(async () => [
        { tenant_id: 'tenant', obligation_id: 'obligation', snapshot_id: null },
      ]),
    };
    const queue = { add: vi.fn().mockRejectedValueOnce(Error('Redis lost')).mockResolvedValue({}) };
    const scheduler = new PulseReportLifecycleScheduler(repository as never, queue, true);
    expect((await scheduler.runOnce()).queued).toBe(0);
    expect((await scheduler.runOnce()).queued).toBe(1);
    expect(queue.add.mock.calls[0]?.[2]).toMatchObject({
      jobId: 'pulse-form-obligation',
      attempts: 1,
      removeOnFail: true,
    });
  });
});
