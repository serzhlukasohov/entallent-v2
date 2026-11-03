import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, OnModuleInit } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';
import { QUEUE_NAMES } from '../queue/queue.module';
import { ConversationTraceRepository } from './conversation-trace.repository';

export const CONVERSATION_TRACE_RETENTION_DAYS = 30;
const PURGE_INTERVAL_MS = 60 * 60 * 1000;
const PURGE_JOB_ID = 'conversation-trace-purge-recurring';
const PURGE_BATCH_SIZE = 1_000;
/** Upper bound per run; a backlog larger than this drains over the next hourly runs. */
const PURGE_MAX_BATCHES = 50;

/** Hourly deletion of traced turns older than the 30-day retention, for every tenant. */
@Processor(QUEUE_NAMES.CONVERSATION_TRACE_PURGE)
export class ConversationTracePurgeProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(ConversationTracePurgeProcessor.name);

  constructor(
    private readonly repository: ConversationTraceRepository,
    @InjectQueue(QUEUE_NAMES.CONVERSATION_TRACE_PURGE) private readonly queue: Queue,
  ) {
    super();
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.queue.add('purge', {}, {
        repeat: { every: PURGE_INTERVAL_MS },
        jobId: PURGE_JOB_ID,
        removeOnComplete: true,
      });
    } catch {
      // A diagnostic feature must not stop the worker from starting; the next start schedules it.
      this.logger.error('Conversation trace purge not scheduled: conversation_trace_purge_schedule_failed');
    }
  }

  async process(job: Job): Promise<void> {
    if (job.name !== 'purge') throw new Error('conversation_trace_purge_job_invalid');
    await this.purge(new Date());
  }

  /** Deletes traces older than the retention at `now`; returns how many were deleted. */
  async purge(now: Date): Promise<number> {
    const cutoff = new Date(now.getTime() - CONVERSATION_TRACE_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    let deleted = 0;
    try {
      for (let batch = 0; batch < PURGE_MAX_BATCHES; batch += 1) {
        const count = await this.repository.purgeCreatedBefore(cutoff, PURGE_BATCH_SIZE);
        deleted += count;
        if (count < PURGE_BATCH_SIZE) break;
      }
    } catch {
      this.logger.error(`Conversation trace purge failed after deleted=${deleted}`);
      throw new Error('conversation_trace_purge_failed');
    }
    this.logger.log(`Conversation trace purge completed: deleted=${deleted}`);
    return deleted;
  }
}
