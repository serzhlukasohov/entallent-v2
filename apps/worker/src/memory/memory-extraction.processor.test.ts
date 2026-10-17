import { Logger } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { MemoryExtractionProcessor } from './memory-extraction.processor';

const privateMarker = 'private employee content';
const job = {
  id: 'memory-job-1',
  data: {
    conversationId: 'conversation-1', userId: 'user-1', tenantId: 'tenant-1',
    inboundMessageId: 'inbound-1', outboundMessageId: 'outbound-1',
    channelType: 'slack', externalConversationId: 'D123', traceId: privateMarker,
  },
} as never;

describe('MemoryExtractionProcessor', () => {
  it('keeps extraction errors out of logs and failed queue jobs', async () => {
    const log = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const startLog = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    try {
      const processor = new MemoryExtractionProcessor({
        execute: vi.fn().mockRejectedValue(new Error(privateMarker)),
      } as never, { schedule: vi.fn() } as never,
      { status: vi.fn().mockResolvedValue('legacy') } as never, {} as never);

      await expect(processor.process(job)).rejects.toThrow('memory_extraction_failed');
      expect(log).toHaveBeenCalledWith('Memory extraction job=memory-job-1 failed: memory_extraction_failed');
      expect(JSON.stringify([...log.mock.calls, ...startLog.mock.calls])).not.toContain(privateMarker);
    } finally {
      log.mockRestore();
      startLog.mockRestore();
    }
  });

  it('keeps follow-up scheduling errors out of logs and failed queue jobs', async () => {
    const log = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    try {
      const schedule = vi.fn().mockRejectedValue(new Error(privateMarker));
      const processor = new MemoryExtractionProcessor({
        execute: vi.fn().mockResolvedValue({ followUpCandidates: [{}] }),
      } as never, { schedule } as never,
      { status: vi.fn().mockResolvedValue('legacy') } as never, {} as never);

      await expect(processor.process(job)).rejects.toThrow('memory_extraction_failed');
      expect(schedule).toHaveBeenCalledOnce();
      expect(JSON.stringify(log.mock.calls)).not.toContain(privateMarker);
    } finally {
      log.mockRestore();
    }
  });

  it('resumes unqueued follow-ups without repeating a completed memory extraction', async () => {
    const prepare = vi.fn();
    const dispatch = vi.fn().mockResolvedValue(undefined);
    const markCommittedDispatchQueued = vi.fn().mockResolvedValue(undefined);
    const processor = new MemoryExtractionProcessor({ prepare } as never,
      { dispatch } as never,
      { status: vi.fn().mockResolvedValue('complete') } as never,
      {
        findUnqueuedCommittedFollowUps: vi.fn().mockResolvedValue([{
          scheduledActionId: 'action-1', dueAt: new Date('2026-10-01T00:00:00Z'),
        }]),
        markCommittedDispatchQueued,
      } as never);

    await processor.process(job);

    expect(prepare).not.toHaveBeenCalled();
    expect(dispatch).toHaveBeenCalledOnce();
    expect(markCommittedDispatchQueued).toHaveBeenCalledWith(expect.objectContaining({
      inboundMessageId: 'inbound-1', kind: 'follow_up_execution', targetId: 'action-1',
    }));
  });
});
