import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Job } from 'bullmq';
import { OnboardingActionProcessor } from './onboarding-action.processor';

const data = { tenantId: 't1', personId: 'p1', action: 'start', actionTs: '1788430500.000100', messageTs: '1.1', channelId: 'D1' };

describe('OnboardingActionProcessor', () => {
  it('applies a button action with the Slack action time and no message persistence', async () => {
    const apply = vi.fn().mockResolvedValue({ changed: true });
    await new OnboardingActionProcessor({ apply } as never).process({ data } as Job<never>);
    expect(apply).toHaveBeenCalledWith('t1', 'p1', {
      type: 'action', action: 'start', source: 'button', at: new Date(1788430500000.1),
    });
  });

  it('rejects an unknown action', async () => {
    const apply = vi.fn();
    await expect(new OnboardingActionProcessor({ apply } as never).process({ data: { ...data, action: 'nope' } } as Job<never>))
      .rejects.toThrow();
    expect(apply).not.toHaveBeenCalled();
  });

  it('treats an explicit button kind like a legacy job without kind', async () => {
    const apply = vi.fn().mockResolvedValue({ changed: true });
    await new OnboardingActionProcessor({ apply } as never).process({ data: { ...data, kind: 'button' } } as Job<never>);
    expect(apply).toHaveBeenCalledWith('t1', 'p1', expect.objectContaining({ type: 'action', source: 'button' }));
  });

  it('applies a system role_changed event with the current time', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-07T10:00:00Z'));
    const apply = vi.fn().mockResolvedValue({ changed: true });
    await new OnboardingActionProcessor({ apply } as never).process({ data: {
      kind: 'system', tenantId: 't1', personId: 'p1', event: { type: 'role_changed', from: 'manager', to: 'employee' },
    } } as Job<never>);
    expect(apply).toHaveBeenCalledWith('t1', 'p1', {
      type: 'role_changed', from: 'manager', to: 'employee', at: new Date('2026-10-07T10:00:00Z'),
    });
    vi.useRealTimers();
  });

  it('applies a system deactivated event', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-07T10:00:00Z'));
    const apply = vi.fn().mockResolvedValue({ changed: true });
    await new OnboardingActionProcessor({ apply } as never).process({ data: {
      kind: 'system', tenantId: 't1', personId: 'p1', event: { type: 'deactivated' },
    } } as Job<never>);
    expect(apply).toHaveBeenCalledWith('t1', 'p1', { type: 'deactivated', at: new Date('2026-10-07T10:00:00Z') });
    vi.useRealTimers();
  });

  it('rejects a system job with an unknown role', async () => {
    const apply = vi.fn();
    await expect(new OnboardingActionProcessor({ apply } as never).process({ data: {
      kind: 'system', tenantId: 't1', personId: 'p1', event: { type: 'role_changed', from: 'x', to: 'employee' },
    } } as Job<never>)).rejects.toThrow();
    expect(apply).not.toHaveBeenCalled();
  });

  describe('dev_intro (local dev console only)', () => {
    const devJob = { data: { kind: 'dev_intro', tenantId: 't1', personId: 'p1' }, timestamp: 1_791_000_000_123 } as Job<never>;
    afterEach(() => { vi.unstubAllEnvs(); });

    it.each(['development', 'test'])('sends a fresh intro when NODE_ENV=%s', async (nodeEnv) => {
      vi.stubEnv('NODE_ENV', nodeEnv);
      const apply = vi.fn();
      const devIntro = { send: vi.fn().mockResolvedValue({ introMessageId: 'i', trustMessageId: 't' }) };
      await new OnboardingActionProcessor({ apply } as never, devIntro as never).process(devJob);
      expect(devIntro.send).toHaveBeenCalledWith('t1', 'p1', 1_791_000_000);
      expect(apply).not.toHaveBeenCalled();
    });

    it.each([undefined, 'true'])('ignores the job in production (ENABLE_DEV_ENDPOINTS=%s)', async (flag) => {
      vi.stubEnv('NODE_ENV', 'production');
      if (flag) vi.stubEnv('ENABLE_DEV_ENDPOINTS', flag);
      const devIntro = { send: vi.fn() };
      await expect(new OnboardingActionProcessor({ apply: vi.fn() } as never, devIntro as never).process(devJob))
        .resolves.toBeUndefined();
      expect(devIntro.send).not.toHaveBeenCalled();
    });
  });
});
