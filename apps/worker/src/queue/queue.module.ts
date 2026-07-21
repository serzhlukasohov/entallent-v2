import { Module, Global } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { RedisService } from './redis.service';
import type { Env } from '@entalent/config';

export const QUEUE_NAMES = {
  CONVERSATION: 'conversation',
  MEMORY_EXTRACTION: 'memory-extraction',
  SURVEY_EVIDENCE: 'survey-evidence',
  RISK_ANALYSIS: 'risk-analysis',
  FOLLOWUP_PLANNING: 'followup-planning',
  FOLLOWUP_EXECUTION: 'followup-execution',
  MESSAGE_SEND: 'message-send',
  PROACTIVE_SCAN: 'proactive-scan',
  GROUP_CONFIRMATION: 'group-confirmation',
  GROUP_REPORT: 'group-report',
} as const;

@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => {
        const redisUrl = new URL(config.get('REDIS_URL', { infer: true }) ?? 'redis://localhost:6379');
        return {
          connection: {
            host: redisUrl.hostname,
            port: Number(redisUrl.port) || 6379,
            ...(redisUrl.password ? { password: decodeURIComponent(redisUrl.password) } : {}),
          },
          defaultJobOptions: {
            attempts: 3,
            backoff: { type: 'exponential', delay: 1000 },
            removeOnComplete: { count: 1000 },
            removeOnFail: { count: 5000 },
          },
        };
      },
    }),
    BullModule.registerQueue(
      { name: QUEUE_NAMES.CONVERSATION },
      { name: QUEUE_NAMES.MEMORY_EXTRACTION },
      { name: QUEUE_NAMES.SURVEY_EVIDENCE },
      { name: QUEUE_NAMES.RISK_ANALYSIS },
      { name: QUEUE_NAMES.FOLLOWUP_PLANNING },
      { name: QUEUE_NAMES.FOLLOWUP_EXECUTION },
      { name: QUEUE_NAMES.MESSAGE_SEND },
      { name: QUEUE_NAMES.PROACTIVE_SCAN },
      { name: QUEUE_NAMES.GROUP_CONFIRMATION },
      { name: QUEUE_NAMES.GROUP_REPORT },
    ),
  ],
  providers: [RedisService],
  exports: [BullModule, RedisService],
})
export class QueueModule {}
