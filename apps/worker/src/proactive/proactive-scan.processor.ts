import { Processor, WorkerHost, InjectQueue } from '@nestjs/bullmq';
import { Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job, Queue } from 'bullmq';
import { ProactiveSchedulerUseCase } from '@entalent/application';
import type { Env } from '@entalent/config';
import { QUEUE_NAMES } from '../queue/queue.module';

export interface ProactiveScanJob {
  /** Optional tenant filter — omitted for the scheduled repeatable scan */
  tenantId?: string;
}

const REPEATABLE_JOB_ID = 'proactive-scan-recurring';

@Processor(QUEUE_NAMES.PROACTIVE_SCAN)
export class ProactiveScanProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(ProactiveScanProcessor.name);

  constructor(
    private readonly scheduler: ProactiveSchedulerUseCase,
    @InjectQueue(QUEUE_NAMES.PROACTIVE_SCAN) private readonly queue: Queue<ProactiveScanJob>,
    private readonly config: ConfigService<Env, true>,
  ) {
    super();
  }

  /** Register the recurring scan once on boot. Fixed jobId keeps it idempotent across restarts. */
  async onModuleInit(): Promise<void> {
    const intervalMin = this.config.get('PROACTIVE_SCAN_INTERVAL_MIN', { infer: true });
    await this.queue.add(
      'scan',
      {},
      {
        repeat: { every: intervalMin * 60 * 1000 },
        jobId: REPEATABLE_JOB_ID,
        removeOnComplete: true,
        removeOnFail: true,
      },
    );
    this.logger.log(`Registered repeatable proactive scan every ${intervalMin}min`);
  }

  async process(job: Job<ProactiveScanJob>): Promise<void> {
    const result = await this.scheduler.scan({ tenantId: job.data.tenantId });
    this.logger.log(
      `Proactive scan job=${job.id} — candidates=${result.candidatesFound} enqueued=${result.enqueued} skippedQuietHours=${result.skippedQuietHours}`,
    );
  }
}
