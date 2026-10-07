import { describe, expect, it, vi } from 'vitest';
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
});
