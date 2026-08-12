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
import { ALL_QUEUE_NAMES } from '@entalent/contracts';
import { Job, Queue } from 'bullmq';
import { ApiKeyGuard } from '../auth/api-key.guard';
import type { Env } from '@entalent/config';

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
    this.queues = ALL_QUEUE_NAMES.map((name) => new Queue(name, { connection }));
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
  ): Promise<{ retried: boolean; queue?: string; reason?: string; matches?: string[] }> {
    const matches: Array<{ queue: Queue; job: Job }> = [];

    for (const queue of this.queues) {
      const job = await queue.getJob(jobId);
      if (job) {
        matches.push({ queue, job });
      }
    }

    if (matches.length === 0) return { retried: false, reason: 'Job not found in any queue' };
    if (matches.length > 1) {
      return {
        retried: false,
        reason: 'Job id is ambiguous across queues; retry by queue name',
        matches: matches.map((match) => match.queue.name),
      };
    }

    const [match] = matches;
    await match.job.retry();
    this.logger.log(`Retried job ${jobId} in queue ${match.queue.name}`);
    return { retried: true, queue: match.queue.name };
  }

  @Post('dead-letter/:queueName/:jobId/retry')
  async retryJobInQueue(
    @Param('queueName') queueName: string,
    @Param('jobId') jobId: string,
  ): Promise<{ retried: boolean; queue?: string; reason?: string }> {
    const queue = this.queues.find((q) => q.name === queueName);
    if (!queue) return { retried: false, reason: 'Queue not found' };

    const job = await queue.getJob(jobId);
    if (!job) return { retried: false, queue: queue.name, reason: 'Job not found in queue' };

    await job.retry();
    this.logger.log(`Retried job ${jobId} in queue ${queue.name}`);
    return { retried: true, queue: queue.name };
  }
}
