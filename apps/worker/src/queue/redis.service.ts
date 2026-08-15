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
    const db = parseRedisDatabase(redisUrl.pathname);
    this._client = new IORedis({
      host: redisUrl.hostname,
      port: Number(redisUrl.port) || 6379,
      db,
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

function parseRedisDatabase(pathname: string): number {
  const raw = pathname.slice(1);
  if (!raw) return 0;
  const db = Number(raw);
  if (!Number.isInteger(db) || db < 0) {
    throw new Error('invalid_redis_database');
  }
  return db;
}
