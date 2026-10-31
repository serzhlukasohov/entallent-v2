import { afterEach, describe, expect, it, vi } from 'vitest';
import { FormPulseReportUseCase } from './form-pulse-report.use-case';
describe('R2 fenced bounded assembly heartbeat', () => {
  afterEach(() => vi.useRealTimers());
  function fixture(lost = false) {
    vi.useFakeTimers();
    let expires = Date.now() + 120000;
    const lease = { tenantId: 'tenant', obligationId: 'obligation', token: 1 };
    const lifecycle = {
      claim: vi.fn(async () => lease),
      renew: vi.fn(async () => {
        if (lost) return false;
        expires = Date.now() + 120000;
        return true;
      }),
      load: vi.fn(async () => (Date.now() < expires && !lost ? lease : null)),
      defer: vi.fn(),
      rebaseHistory: vi.fn(async () => null),
    };
    const builder = {
      executeInitiated: vi.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 130000));
        return Date.now() < expires ? { status: 'built' } : { status: 'invalidated' };
      }),
    };
    const snapshots = { freeze: vi.fn(async () => ({ status: 'snapshot_ready' })) };
    return {
      lifecycle,
      snapshots,
      run: new FormPulseReportUseCase(
        lifecycle as never,
        builder as never,
        snapshots as never,
      ).execute('tenant', 'obligation'),
    };
  }
  it('renews healthy actual assembly past the original two-minute lease and cleans every timer', async () => {
    const f = fixture();
    await vi.advanceTimersByTimeAsync(130001);
    expect((await f.run).status).toBe('snapshot_ready');
    expect(f.lifecycle.renew.mock.calls.length).toBeGreaterThan(1);
    expect(f.snapshots.freeze).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('lost renewal cannot freeze or defer as source invalidation and leaves no timer', async () => {
    const f = fixture(true);
    await vi.advanceTimersByTimeAsync(130001);
    expect((await f.run).status).toBe('lease_lost');
    expect(f.snapshots.freeze).not.toHaveBeenCalled();
    expect(f.lifecycle.defer).not.toHaveBeenCalledWith(expect.anything(), 'invalidated');
    expect(vi.getTimerCount()).toBe(0);
  });
});
