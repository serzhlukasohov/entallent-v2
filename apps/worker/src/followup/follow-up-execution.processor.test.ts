import { Logger } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { FollowUpExecutionProcessor } from './follow-up-execution.processor';

describe('FollowUpExecutionProcessor', () => {
  it('does not persist private model errors in BullMQ failures or logs', async () => {
    const privateText = 'private employee reminder content';
    const logger = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const startLog = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    try {
      const processor = new FollowUpExecutionProcessor({
        execute: vi.fn().mockRejectedValue(new Error(privateText)),
      } as never);
      await expect(processor.process({
        id: 'followup-job',
        data: { scheduledActionId: 'action-1', tenantId: 'tenant-1', userId: 'user-1',
          traceId: privateText },
      } as never)).rejects.toThrow('follow_up_execution_failed');
      expect(JSON.stringify([...logger.mock.calls, ...startLog.mock.calls])).not.toContain(privateText);
    } finally {
      logger.mockRestore();
      startLog.mockRestore();
    }
  });
});
