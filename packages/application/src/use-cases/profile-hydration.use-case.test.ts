import { describe, it, expect, vi } from 'vitest';
import { ProfileHydrationUseCase } from './profile-hydration.use-case';

const INPUT = { userId: 'u-1', tenantId: 't-1', channelType: 'slack' };

describe('ProfileHydrationUseCase', () => {
  it('stores the display name and timezone when the channel returns a profile', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ext = {
      fetchProfile: vi
        .fn()
        .mockResolvedValue({
          externalUserId: 'ext-1',
          displayName: 'Alice',
          timezone: 'Europe/Berlin',
        }),
    } as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const repo = { updateProfile: vi.fn().mockResolvedValue(undefined) } as any;
    await new ProfileHydrationUseCase(ext, repo).execute(INPUT);
    expect(repo.updateProfile).toHaveBeenCalledWith('u-1', 't-1', {
      displayName: 'Alice',
      timezone: 'Europe/Berlin',
    });
  });
  it('does nothing when the channel returns no profile', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ext = { fetchProfile: vi.fn().mockResolvedValue(null) } as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const repo = { updateProfile: vi.fn() } as any;
    await new ProfileHydrationUseCase(ext, repo).execute(INPUT);
    expect(repo.updateProfile).not.toHaveBeenCalled();
  });
});
