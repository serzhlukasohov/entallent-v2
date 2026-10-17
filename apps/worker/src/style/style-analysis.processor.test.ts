import { Logger } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { StyleAnalysisProcessor } from './style-analysis.processor';

describe('StyleAnalysisProcessor', () => {
  it('keeps analysis errors out of logs and failed queue jobs', async () => {
    const privateMarker = 'private employee content';
    const log = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    try {
      const processor = new StyleAnalysisProcessor({
        execute: vi.fn().mockRejectedValue(new Error(privateMarker)),
      } as never);

      await expect(processor.process({ data: {
        conversationId: 'conversation-1', userId: 'user-1', tenantId: 'tenant-1',
        traceId: privateMarker,
      } } as never)).rejects.toThrow('style_analysis_failed');
      expect(log).toHaveBeenCalledWith('style_analysis_failed');
      expect(JSON.stringify(log.mock.calls)).not.toContain(privateMarker);
    } finally {
      log.mockRestore();
    }
  });
});
