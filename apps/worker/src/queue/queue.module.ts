import { Module, Global } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { QUEUE_NAMES } from '@entalent/contracts';
import { RedisService } from './redis.service';
import type { Env } from '@entalent/config';

export { QUEUE_NAMES };

@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => {
        const redisUrl = new URL(
          config.get('REDIS_URL', { infer: true }) ?? 'redis://localhost:6379',
        );
        const db = parseRedisDatabase(redisUrl.pathname);
        return {
          connection: {
            host: redisUrl.hostname,
            port: Number(redisUrl.port) || 6379,
            db,
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
      { name: QUEUE_NAMES.GROUP_REPORT },
      { name: QUEUE_NAMES.STYLE_ANALYSIS },
      { name: QUEUE_NAMES.PROFILE_HYDRATION },
    ),
  ],
  providers: [RedisService],
  exports: [BullModule, RedisService],
})
export class QueueModule {}

function parseRedisDatabase(pathname: string): number {
  const raw = pathname.slice(1);
  if (!raw) return 0;
  const db = Number(raw);
  if (!Number.isInteger(db) || db < 0) {
    throw new Error('invalid_redis_database');
  }
  return db;
}
