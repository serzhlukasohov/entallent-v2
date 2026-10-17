import { Logger } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { ProfileHydrationProcessor } from './profile-hydration.processor';

describe('ProfileHydrationProcessor', () => {
  it('keeps provider error text out of logs and failed queue jobs', async () => {
    const privateMarker = 'private employee content';
    const log = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    try {
      const processor = new ProfileHydrationProcessor({
        execute: vi.fn().mockRejectedValue(new Error(privateMarker)),
      } as never);

      await expect(processor.process({ data: {
        userId: 'user-1', tenantId: 'tenant-1', channelType: 'slack',
        externalWorkspaceId: 'workspace-1', traceId: privateMarker,
      } } as never)).rejects.toThrow('profile_hydration_failed');
      expect(log).toHaveBeenCalledWith('profile_hydration_failed');
      expect(JSON.stringify(log.mock.calls)).not.toContain(privateMarker);
    } finally {
      log.mockRestore();
    }
  });
});
