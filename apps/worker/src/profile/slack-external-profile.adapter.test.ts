import { Logger } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { SlackExternalProfileAdapter } from './slack-external-profile.adapter';

const slack = vi.hoisted(() => ({ getUserProfile: vi.fn() }));
vi.mock('@entalent/channel-slack', () => ({
  SlackAdapter: class { getUserProfile = slack.getUserProfile; },
}));

describe('SlackExternalProfileAdapter', () => {
  it('does not log provider error text while retaining retryable failure', async () => {
    const privateMarker = 'private employee content';
    slack.getUserProfile.mockRejectedValueOnce(new Error(privateMarker));
    const log = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const adapter = new SlackExternalProfileAdapter({
      findSlackAccountByUserId: vi.fn().mockResolvedValue({
        externalWorkspaceId: 'T123', externalUserId: 'U123',
      }),
      findByExternalWorkspace: vi.fn().mockResolvedValue({ botToken: 'test-token' }),
    } as never);

    try {
      await expect(adapter.fetchProfile('user-1', 'tenant-1', 'slack')).rejects.toThrow(privateMarker);
      expect(log).toHaveBeenCalledWith('external_profile_fetch_failed user=user-1');
      expect(JSON.stringify(log.mock.calls)).not.toContain(privateMarker);
    } finally {
      log.mockRestore();
    }
  });
});
