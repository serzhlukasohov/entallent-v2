import { describe, it, expect, vi } from 'vitest';
import type { ExternalProfilePort } from '../ports/external-profile.port';
import type { UserProfileRepositoryPort } from '../ports/user-profile.repository.port';
import { ProfileHydrationUseCase } from './profile-hydration.use-case';

const INPUT = { userId: 'u-1', tenantId: 't-1', channelType: 'slack' };

describe('ProfileHydrationUseCase', () => {
  it('stores the display name and timezone when the channel returns a profile', async () => {
    const ext: ExternalProfilePort = {
      fetchProfile: vi.fn().mockResolvedValue({
        externalUserId: 'ext-1',
        displayName: 'Alice',
        timezone: 'Europe/Berlin',
      }),
      fetchTimezone: vi.fn(),
    };
    const repo: UserProfileRepositoryPort = {
      updateTimezone: vi.fn(),
      updateProfile: vi.fn().mockResolvedValue(undefined),
      recordProfileHydrationOutcome: vi.fn().mockResolvedValue(undefined),
    };
    await new ProfileHydrationUseCase(ext, repo).execute(INPUT);
    expect(repo.updateProfile).toHaveBeenCalledWith('u-1', 't-1', {
      displayName: 'Alice',
      timezone: 'Europe/Berlin',
    });
    expect(repo.recordProfileHydrationOutcome).toHaveBeenCalledWith(
      'u-1',
      't-1',
      'slack',
      expect.objectContaining({ status: 'success', occurredAt: expect.any(Date) }),
    );
  });

  it('records a missing profile when the channel returns no profile', async () => {
    const ext: ExternalProfilePort = {
      fetchProfile: vi.fn().mockResolvedValue(null),
      fetchTimezone: vi.fn(),
    };
    const repo: UserProfileRepositoryPort = {
      updateTimezone: vi.fn(),
      updateProfile: vi.fn(),
      recordProfileHydrationOutcome: vi.fn().mockResolvedValue(undefined),
    };
    await new ProfileHydrationUseCase(ext, repo).execute(INPUT);
    expect(repo.updateProfile).not.toHaveBeenCalled();
    expect(repo.recordProfileHydrationOutcome).toHaveBeenCalledWith(
      'u-1',
      't-1',
      'slack',
      expect.objectContaining({
        status: 'missing_profile',
        reason: 'external_profile_unavailable',
        occurredAt: expect.any(Date),
      }),
    );
  });

  it('records a failed outcome and rethrows fetch errors', async () => {
    const err = new Error('Slack timeout');
    const ext: ExternalProfilePort = {
      fetchProfile: vi.fn().mockRejectedValue(err),
      fetchTimezone: vi.fn(),
    };
    const repo: UserProfileRepositoryPort = {
      updateTimezone: vi.fn(),
      updateProfile: vi.fn(),
      recordProfileHydrationOutcome: vi.fn().mockResolvedValue(undefined),
    };

    await expect(new ProfileHydrationUseCase(ext, repo).execute(INPUT)).rejects.toThrow(
      'Slack timeout',
    );
    expect(repo.recordProfileHydrationOutcome).toHaveBeenCalledWith(
      'u-1',
      't-1',
      'slack',
      expect.objectContaining({
        status: 'failed',
        error: 'Slack timeout',
        occurredAt: expect.any(Date),
      }),
    );
  });

  it('does not retry a successful profile update when status recording fails', async () => {
    const ext: ExternalProfilePort = {
      fetchProfile: vi.fn().mockResolvedValue({
        externalUserId: 'ext-1',
        displayName: 'Alice',
        timezone: 'Europe/Berlin',
      }),
      fetchTimezone: vi.fn(),
    };
    const repo: UserProfileRepositoryPort = {
      updateTimezone: vi.fn(),
      updateProfile: vi.fn().mockResolvedValue(undefined),
      recordProfileHydrationOutcome: vi.fn().mockRejectedValue(new Error('metadata failed')),
    };

    await expect(new ProfileHydrationUseCase(ext, repo).execute(INPUT)).resolves.toBeUndefined();
    expect(repo.updateProfile).toHaveBeenCalledOnce();
  });

  it('preserves the original failure when failure status recording fails', async () => {
    const err = new Error('Slack timeout');
    const ext: ExternalProfilePort = {
      fetchProfile: vi.fn().mockRejectedValue(err),
      fetchTimezone: vi.fn(),
    };
    const repo: UserProfileRepositoryPort = {
      updateTimezone: vi.fn(),
      updateProfile: vi.fn(),
      recordProfileHydrationOutcome: vi.fn().mockRejectedValue(new Error('metadata failed')),
    };

    await expect(new ProfileHydrationUseCase(ext, repo).execute(INPUT)).rejects.toThrow(
      'Slack timeout',
    );
  });
});
