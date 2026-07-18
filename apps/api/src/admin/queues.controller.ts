import {
  Controller,
  Get,
  Post,
  Param,
  UseGuards,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Inject,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { ApiKeyGuard } from '../auth/api-key.guard';
import type { Env } from '@entalent/config';

const ALL_QUEUES = [
  'conversation',
  'memory-extraction',
  'survey-evidence',
  'risk-analysis',
  'followup-planning',
  'followup-execution',
  'message-send',
] as const;

@Controller('admin/queues')
@UseGuards(ApiKeyGuard)
export class QueuesController implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(QueuesController.name);
  private queues: Queue[] = [];

  constructor(@Inject(ConfigService) private readonly config: ConfigService<Env, true>) {}

  onModuleInit(): void {
    const redisUrl = new URL(this.config.get('REDIS_URL', { infer: true }));
    const connection = {
      host: redisUrl.hostname,
      port: Number(redisUrl.port) || 6379,
      ...(redisUrl.password ? { password: decodeURIComponent(redisUrl.password) } : {}),
    };
    this.queues = ALL_QUEUES.map((name) => new Queue(name, { connection }));
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all(this.queues.map((q) => q.close()));
  }

  @Get()
  async getStats(): Promise<{ queues: unknown[]; timestamp: string }> {
    const stats = await Promise.all(
      this.queues.map(async (q) => ({
        name: q.name,
        counts: await q.getJobCounts(),
      })),
    );
    return { queues: stats, timestamp: new Date().toISOString() };
  }

  @Get('dead-letter')
  async getDeadLetterJobs(): Promise<{ jobs: unknown[] }> {
    const perQueue = await Promise.all(
      this.queues.map(async (q) => {
        const failed = await q.getFailed(0, 50);
        return failed.map((job) => ({
          id: job.id,
          queue: q.name,
          name: job.name,
          failedReason: job.failedReason,
          attemptsMade: job.attemptsMade,
          data: job.data,
          timestamp: job.timestamp,
          finishedOn: job.finishedOn,
        }));
      }),
    );
    return { jobs: perQueue.flat() };
  }

  @Post('dead-letter/:jobId/retry')
  async retryJob(
    @Param('jobId') jobId: string,
  ): Promise<{ retried: boolean; queue?: string; reason?: string }> {
    for (const queue of this.queues) {
      const job = await queue.getJob(jobId);
      if (job) {
        await job.retry();
        this.logger.log(`Retried job ${jobId} in queue ${queue.name}`);
        return { retried: true, queue: queue.name };
      }
    }
    return { retried: false, reason: 'Job not found in any queue' };
  }
}
