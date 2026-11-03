import { describe, expect, it, vi } from 'vitest';
import type { Job, Queue } from 'bullmq';
import { ConversationTracePurgeProcessor } from './conversation-trace-purge.processor';
import type { ConversationTraceRepository } from './conversation-trace.repository';

function processorWith(purgeCreatedBefore: ConversationTraceRepository['purgeCreatedBefore']) {
  const add = vi.fn(async () => undefined);
  const processor = new ConversationTracePurgeProcessor(
    { purgeCreatedBefore } as unknown as ConversationTraceRepository,
    { add } as unknown as Queue,
  );
  return { processor, add };
}

describe('ConversationTracePurgeProcessor', () => {
  it('schedules one hourly repeatable purge job', async () => {
    const { processor, add } = processorWith(async () => 0);
    await processor.onModuleInit();
    expect(add).toHaveBeenCalledWith('purge', {}, expect.objectContaining({
      repeat: { every: 60 * 60 * 1000 }, jobId: 'conversation-trace-purge-recurring',
    }));
  });

  it('deletes in batches everything created more than 30 days ago', async () => {
    const cutoffs: Date[] = [];
    const batches = [1_000, 1_000, 3];
    const { processor } = processorWith(async (cutoff) => { cutoffs.push(cutoff); return batches.shift() ?? 0; });

    await expect(processor.purge(new Date('2026-11-01T00:00:00Z'))).resolves.toBe(2_003);
    expect(cutoffs).toHaveLength(3);
    expect(cutoffs[0]!.toISOString()).toBe('2026-10-02T00:00:00.000Z');
  });

  it('fails with a fixed code and rejects foreign job names', async () => {
    const { processor } = processorWith(async () => { throw new Error('relation does not exist'); });
    await expect(processor.purge(new Date())).rejects.toThrow('conversation_trace_purge_failed');
    await expect(processor.process({ name: 'other' } as Job)).rejects.toThrow('conversation_trace_purge_job_invalid');
  });
});
