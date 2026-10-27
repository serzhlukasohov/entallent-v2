import { describe, expect, it, vi } from 'vitest';
import { validateEnv } from '@entalent/config';
import { ProactiveScanProcessor } from './proactive-scan.processor';

const enabledConfig = { get: () => true } as never;

describe('ProactiveScanProcessor', () => {
  it('dispatches a targeted onboarding job without scanning other proactive candidates', async () => {
    const scan = vi.fn();
    const dispatchPending = vi.fn().mockResolvedValue({ found: 2, queued: 2, failed: 0 });
    const processor = new ProactiveScanProcessor(
      { scan } as never, {} as never, enabledConfig, { dispatchPending } as never, { sweep: vi.fn().mockResolvedValue({ found: 0, enqueued: 0, failed: 0 }) } as never,
      { sweep: vi.fn().mockResolvedValue({ found: 0, reconciled: 0, failed: 0 }) } as never,
    );

    await processor.process({ id: 'pilot', name: 'onboarding-only',
      data: { tenantId: 'tenant-1', unitId: 'unit-1' } } as never);

    expect(dispatchPending).toHaveBeenCalledWith('tenant-1', 'unit-1');
    expect(scan).not.toHaveBeenCalled();
  });

  it('keeps the recurring scan behavior', async () => {
    const scan = vi.fn().mockResolvedValue({ candidatesFound: 0, enqueued: 0, skippedQuietHours: 0, skippedCadence: 0 });
    const dispatchPending = vi.fn().mockResolvedValue({ found: 0, queued: 0, failed: 0 });
    const processor = new ProactiveScanProcessor(
      { scan } as never, {} as never, enabledConfig, { dispatchPending } as never, { sweep: vi.fn().mockResolvedValue({ found: 0, enqueued: 0, failed: 0 }) } as never,
      { sweep: vi.fn().mockResolvedValue({ found: 0, reconciled: 0, failed: 0 }) } as never,
    );

    await processor.process({ id: 'recurring', name: 'scan', data: {} } as never);

    expect(dispatchPending).toHaveBeenCalledWith(undefined);
    expect(scan).toHaveBeenCalledWith({ tenantId: undefined });
  });

  it('rejects an unscoped onboarding job', async () => {
    const dispatchPending = vi.fn();
    const processor = new ProactiveScanProcessor(
      { scan: vi.fn() } as never, {} as never, enabledConfig, { dispatchPending } as never, { sweep: vi.fn().mockResolvedValue({ found: 0, enqueued: 0, failed: 0 }) } as never,
      { sweep: vi.fn().mockResolvedValue({ found: 0, reconciled: 0, failed: 0 }) } as never,
    );
    await expect(processor.process({ id: 'unscoped', name: 'onboarding-only',
      data: { tenantId: 'tenant-1' } } as never)).rejects.toThrow('onboarding_scope_required');
    expect(dispatchPending).not.toHaveBeenCalled();
  });

  it('runs the reminder recovery sweep after dispatch and before the scan', async () => {
    const order: string[] = [];
    const scan = vi.fn(async () => { order.push('scan'); return { candidatesFound: 0, enqueued: 0, skippedQuietHours: 0, skippedCadence: 0 }; });
    const dispatchPending = vi.fn(async () => { order.push('dispatch'); return { found: 0, queued: 0, failed: 0 }; });
    const sweep = vi.fn(async () => { order.push('sweep'); return { found: 1, enqueued: 1, failed: 0 }; });
    const reconcile = vi.fn(async () => { order.push('reconcile'); return { found: 1, reconciled: 1, failed: 0 }; });
    const processor = new ProactiveScanProcessor({ scan } as never, {} as never, enabledConfig, { dispatchPending } as never, { sweep } as never, { sweep: reconcile } as never);
    await processor.process({ id: 'r', name: 'scan', data: { tenantId: 't1' } } as never);
    expect(order).toEqual(['dispatch', 'sweep', 'reconcile', 'scan']);
    expect(sweep).toHaveBeenCalledWith('t1');
    expect(reconcile).toHaveBeenCalledWith('t1');
  });

  it('a sweep failure never blocks the scan', async () => {
    const scan = vi.fn().mockResolvedValue({ candidatesFound: 0, enqueued: 0, skippedQuietHours: 0, skippedCadence: 0 });
    const processor = new ProactiveScanProcessor(
      { scan } as never, {} as never, enabledConfig,
      { dispatchPending: vi.fn().mockResolvedValue({ found: 0, queued: 0, failed: 0 }) } as never,
      { sweep: vi.fn().mockRejectedValue(new Error('db down')) } as never, { sweep: vi.fn().mockResolvedValue({ found: 0, reconciled: 0, failed: 0 }) } as never);
    await processor.process({ id: 'r', name: 'scan', data: {} } as never);
    expect(scan).toHaveBeenCalled();
  });

  it('a role reconcile failure never blocks the scan', async () => {
    const scan = vi.fn().mockResolvedValue({ candidatesFound: 0, enqueued: 0, skippedQuietHours: 0, skippedCadence: 0 });
    const processor = new ProactiveScanProcessor(
      { scan } as never, {} as never, enabledConfig,
      { dispatchPending: vi.fn().mockResolvedValue({ found: 0, queued: 0, failed: 0 }) } as never,
      { sweep: vi.fn().mockResolvedValue({ found: 0, enqueued: 0, failed: 0 }) } as never,
      { sweep: vi.fn().mockRejectedValue(new Error('db down')) } as never);
    await processor.process({ id: 'r', name: 'scan', data: {} } as never);
    expect(scan).toHaveBeenCalled();
  });

  it('does not sweep in a unit-scoped onboarding-only job', async () => {
    const sweep = vi.fn();
    const processor = new ProactiveScanProcessor({ scan: vi.fn() } as never, {} as never, enabledConfig,
      { dispatchPending: vi.fn().mockResolvedValue({ found: 0, queued: 0, failed: 0 }) } as never, { sweep } as never, { sweep } as never);
    await processor.process({ id: 'o', name: 'onboarding-only', data: { tenantId: 't', unitId: 'u' } } as never);
    expect(sweep).not.toHaveBeenCalled();
  });

  describe('PROACTIVE_SCAN_ENABLED=false', () => {
    const disabledConfig = (): never => ({ get: vi.fn((key: string) => (key === 'PROACTIVE_SCAN_ENABLED' ? false : 60)) }) as never;
    const deps = () => ({
      scan: vi.fn(),
      dispatchPending: vi.fn().mockResolvedValue({ found: 0, queued: 0, failed: 0 }),
      sweep: vi.fn().mockResolvedValue({ found: 0, enqueued: 0, failed: 0 }),
      reconcile: vi.fn().mockResolvedValue({ found: 0, reconciled: 0, failed: 0 }),
      add: vi.fn(),
    });
    const build = (d: ReturnType<typeof deps>) => new ProactiveScanProcessor(
      { scan: d.scan } as never, { add: d.add } as never, disabledConfig(),
      { dispatchPending: d.dispatchPending } as never, { sweep: d.sweep } as never, { sweep: d.reconcile } as never);

    it('does not register the repeatable scan', async () => {
      const d = deps();
      await build(d).onModuleInit();
      expect(d.add).not.toHaveBeenCalled();
    });

    it('ignores a stale scan job', async () => {
      const d = deps();
      await build(d).process({ id: 'stale', name: 'scan', data: {} } as never);
      expect(d.scan).not.toHaveBeenCalled();
      expect(d.dispatchPending).not.toHaveBeenCalled();
      expect(d.sweep).not.toHaveBeenCalled();
      expect(d.reconcile).not.toHaveBeenCalled();
    });

    it('still processes an onboarding-only job', async () => {
      const d = deps();
      await build(d).process({ id: 'o', name: 'onboarding-only', data: { tenantId: 't', unitId: 'u' } } as never);
      expect(d.dispatchPending).toHaveBeenCalledWith('t', 'u');
      expect(d.scan).not.toHaveBeenCalled();
    });
  });

  it('registers the repeatable scan when enabled', async () => {
    const add = vi.fn();
    const config = { get: vi.fn((key: string) => (key === 'PROACTIVE_SCAN_ENABLED' ? true : 60)) } as never;
    const processor = new ProactiveScanProcessor({ scan: vi.fn() } as never, { add } as never, config,
      {} as never, {} as never, {} as never);
    await processor.onModuleInit();
    expect(add).toHaveBeenCalledWith('scan', {}, expect.objectContaining({ repeat: { every: 3_600_000 }, jobId: 'proactive-scan-recurring' }));
  });

  describe('PROACTIVE_SCAN_ENABLED parsing (@entalent/config)', () => {
    const base = {
      DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/entalent_test',
      REDIS_URL: 'redis://localhost:6379',
      FIELD_ENCRYPTION_KEY: '0'.repeat(64),
      OPENAI_API_KEY: 'sk-test-placeholder',
    };

    it('defaults to true when absent', () => {
      expect(validateEnv(base).PROACTIVE_SCAN_ENABLED).toBe(true);
    });

    it.each([['false'], ['0']])('%s disables the scan', (value) => {
      expect(validateEnv({ ...base, PROACTIVE_SCAN_ENABLED: value }).PROACTIVE_SCAN_ENABLED).toBe(false);
    });
  });
});
