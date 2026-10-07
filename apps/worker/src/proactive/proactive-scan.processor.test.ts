import { describe, expect, it, vi } from 'vitest';
import { ProactiveScanProcessor } from './proactive-scan.processor';

describe('ProactiveScanProcessor', () => {
  it('dispatches a targeted onboarding job without scanning other proactive candidates', async () => {
    const scan = vi.fn();
    const dispatchPending = vi.fn().mockResolvedValue({ found: 2, queued: 2, failed: 0 });
    const processor = new ProactiveScanProcessor(
      { scan } as never, {} as never, {} as never, { dispatchPending } as never, { sweep: vi.fn().mockResolvedValue({ found: 0, enqueued: 0, failed: 0 }) } as never,
    );

    await processor.process({ id: 'pilot', name: 'onboarding-only',
      data: { tenantId: 'tenant-1', unitId: 'unit-1' } } as never);

    expect(dispatchPending).toHaveBeenCalledWith('tenant-1', 'unit-1');
    expect(scan).not.toHaveBeenCalled();
  });

  it('keeps the recurring scan behavior', async () => {
    const scan = vi.fn().mockResolvedValue({ candidatesFound: 0, enqueued: 0, skippedQuietHours: 0 });
    const dispatchPending = vi.fn().mockResolvedValue({ found: 0, queued: 0, failed: 0 });
    const processor = new ProactiveScanProcessor(
      { scan } as never, {} as never, {} as never, { dispatchPending } as never, { sweep: vi.fn().mockResolvedValue({ found: 0, enqueued: 0, failed: 0 }) } as never,
    );

    await processor.process({ id: 'recurring', name: 'scan', data: {} } as never);

    expect(dispatchPending).toHaveBeenCalledWith(undefined);
    expect(scan).toHaveBeenCalledWith({ tenantId: undefined });
  });

  it('rejects an unscoped onboarding job', async () => {
    const dispatchPending = vi.fn();
    const processor = new ProactiveScanProcessor(
      { scan: vi.fn() } as never, {} as never, {} as never, { dispatchPending } as never, { sweep: vi.fn().mockResolvedValue({ found: 0, enqueued: 0, failed: 0 }) } as never,
    );
    await expect(processor.process({ id: 'unscoped', name: 'onboarding-only',
      data: { tenantId: 'tenant-1' } } as never)).rejects.toThrow('onboarding_scope_required');
    expect(dispatchPending).not.toHaveBeenCalled();
  });

  it('runs the reminder recovery sweep after dispatch and before the scan', async () => {
    const order: string[] = [];
    const scan = vi.fn(async () => { order.push('scan'); return { candidatesFound: 0, enqueued: 0, skippedQuietHours: 0 }; });
    const dispatchPending = vi.fn(async () => { order.push('dispatch'); return { found: 0, queued: 0, failed: 0 }; });
    const sweep = vi.fn(async () => { order.push('sweep'); return { found: 1, enqueued: 1, failed: 0 }; });
    const processor = new ProactiveScanProcessor({ scan } as never, {} as never, {} as never, { dispatchPending } as never, { sweep } as never);
    await processor.process({ id: 'r', name: 'scan', data: { tenantId: 't1' } } as never);
    expect(order).toEqual(['dispatch', 'sweep', 'scan']);
    expect(sweep).toHaveBeenCalledWith('t1');
  });

  it('a sweep failure never blocks the scan', async () => {
    const scan = vi.fn().mockResolvedValue({ candidatesFound: 0, enqueued: 0, skippedQuietHours: 0 });
    const processor = new ProactiveScanProcessor(
      { scan } as never, {} as never, {} as never,
      { dispatchPending: vi.fn().mockResolvedValue({ found: 0, queued: 0, failed: 0 }) } as never,
      { sweep: vi.fn().mockRejectedValue(new Error('db down')) } as never);
    await processor.process({ id: 'r', name: 'scan', data: {} } as never);
    expect(scan).toHaveBeenCalled();
  });

  it('does not sweep in a unit-scoped onboarding-only job', async () => {
    const sweep = vi.fn();
    const processor = new ProactiveScanProcessor({ scan: vi.fn() } as never, {} as never, {} as never,
      { dispatchPending: vi.fn().mockResolvedValue({ found: 0, queued: 0, failed: 0 }) } as never, { sweep } as never);
    await processor.process({ id: 'o', name: 'onboarding-only', data: { tenantId: 't', unitId: 'u' } } as never);
    expect(sweep).not.toHaveBeenCalled();
  });
});
