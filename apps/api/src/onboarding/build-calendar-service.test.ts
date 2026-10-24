import { describe, expect, it, vi } from 'vitest';

const bull = vi.hoisted(() => ({ ctor: vi.fn(), close: vi.fn().mockResolvedValue(undefined), add: vi.fn() }));
vi.mock('bullmq', () => ({
  Queue: class { constructor(...a: unknown[]) { bull.ctor(...a); } add = bull.add; close = bull.close; on = vi.fn(); disconnect = vi.fn().mockResolvedValue(undefined); },
}));

import { buildCalendarService, redisConnectionFromUrl } from './build-calendar-service';

describe('buildCalendarService', () => {
  it('gives up on an unreachable Redis instead of hanging (reports failed)', async () => {
    vi.useFakeTimers();
    bull.add.mockReturnValue(new Promise(() => undefined));
    const built = buildCalendarService({} as never, { REDIS_URL: 'redis://localhost:6399' });
    const rec = (built.service as unknown as { recalculator: { recalculateScheduledReminders(t: string): Promise<void> } }).recalculator;
    const pending = rec.recalculateScheduledReminders('t1');
    const assertion = expect(pending).rejects.toThrow('recalculation_queue_timeout');
    await vi.advanceTimersByTimeAsync(5_001);
    await assertion;
    vi.useRealTimers();
  });

  it('wires the real recalculator on the onboarding-reminder queue and closes it', async () => {
    const built = buildCalendarService({} as never, { REDIS_URL: 'redis://:p%40ss@host:6380/2' });
    expect(bull.ctor).toHaveBeenCalledWith('onboarding-reminder',
      { connection: { host: 'host', port: 6380, db: 2, password: 'p@ss' } });
    expect((built.service as unknown as { recalculator: unknown }).recalculator).toBeDefined();
    expect(built.warning).toBeUndefined();
    await built.close();
    expect(bull.close).toHaveBeenCalled();
  });

  it('without REDIS_URL there is no recalculator and a warning', async () => {
    bull.ctor.mockClear();
    const built = buildCalendarService({} as never, {});
    expect(bull.ctor).not.toHaveBeenCalled();
    expect((built.service as unknown as { recalculator: unknown }).recalculator).toBeUndefined();
    expect(built.warning).toMatch(/REDIS_URL/);
    await expect(built.close()).resolves.toBeUndefined();
  });

  it('parses default port and rejects a bad database', () => {
    expect(redisConnectionFromUrl('redis://localhost')).toEqual({ host: 'localhost', port: 6379, db: 0 });
    expect(() => redisConnectionFromUrl('redis://localhost/x')).toThrow('invalid_redis_database');
  });
});
