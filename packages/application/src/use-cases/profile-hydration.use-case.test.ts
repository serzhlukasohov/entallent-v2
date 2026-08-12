import { describe, it, expect, vi } from 'vitest';
import { ProfileHydrationUseCase } from './profile-hydration.use-case';

const INPUT = { userId: 'u-1', tenantId: 't-1', channelType: 'slack' };

describe('ProfileHydrationUseCase', () => {
  it('stores the timezone when the channel returns one', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ext = { fetchTimezone: vi.fn().mockResolvedValue('Europe/Berlin') } as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const repo = { updateTimezone: vi.fn().mockResolvedValue(undefined) } as any;
    await new ProfileHydrationUseCase(ext, repo).execute(INPUT);
    expect(repo.updateTimezone).toHaveBeenCalledWith('u-1', 't-1', 'Europe/Berlin');
  });
  it('does nothing when the channel returns no timezone', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ext = { fetchTimezone: vi.fn().mockResolvedValue(null) } as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const repo = { updateTimezone: vi.fn() } as any;
    await new ProfileHydrationUseCase(ext, repo).execute(INPUT);
    expect(repo.updateTimezone).not.toHaveBeenCalled();
  });
});
