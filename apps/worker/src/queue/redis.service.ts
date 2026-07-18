import { Injectable, Inject, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import IORedis from 'ioredis';
import type { Env } from '@entalent/config';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private _client!: IORedis;

  constructor(@Inject(ConfigService) private readonly config: ConfigService<Env, true>) {}

  onModuleInit(): void {
    const rawUrl = this.config.get('REDIS_URL', { infer: true });
    const redisUrl = new URL(rawUrl);
    this._client = new IORedis({
      host: redisUrl.hostname,
      port: Number(redisUrl.port) || 6379,
      ...(redisUrl.password ? { password: decodeURIComponent(redisUrl.password) } : {}),
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this._client.quit();
  }

  get client(): IORedis {
    return this._client;
  }
}
