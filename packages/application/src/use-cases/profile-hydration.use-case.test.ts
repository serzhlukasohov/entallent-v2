import { describe, it, expect, vi } from 'vitest';
import type { ExternalProfilePort } from '../ports/external-profile.port';
import type { UserProfileRepositoryPort } from '../ports/user-profile.repository.port';
import { ProfileHydrationUseCase } from './profile-hydration.use-case';

const INPUT = { userId: 'u-1', tenantId: 't-1', channelType: 'slack' };

describe('ProfileHydrationUseCase', () => {
  it('stores the display name and timezone when the channel returns a profile', async () => {
    const ext: ExternalProfilePort = {
      fetchProfile: vi
        .fn()
        .mockResolvedValue({
          externalUserId: 'ext-1',
          displayName: 'Alice',
          timezone: 'Europe/Berlin',
        }),
      fetchTimezone: vi.fn(),
    };
    const repo: UserProfileRepositoryPort = {
      updateTimezone: vi.fn(),
      updateProfile: vi.fn().mockResolvedValue(undefined),
    };
    await new ProfileHydrationUseCase(ext, repo).execute(INPUT);
    expect(repo.updateProfile).toHaveBeenCalledWith('u-1', 't-1', {
      displayName: 'Alice',
      timezone: 'Europe/Berlin',
    });
  });
  it('does nothing when the channel returns no profile', async () => {
    const ext: ExternalProfilePort = {
      fetchProfile: vi.fn().mockResolvedValue(null),
      fetchTimezone: vi.fn(),
    };
    const repo: UserProfileRepositoryPort = {
      updateTimezone: vi.fn(),
      updateProfile: vi.fn(),
    };
    await new ProfileHydrationUseCase(ext, repo).execute(INPUT);
    expect(repo.updateProfile).not.toHaveBeenCalled();
  });
});
