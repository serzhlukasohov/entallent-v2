import { Injectable, Inject, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createDbClient, type DbClient } from '@entalent/database';
import type { Env } from '@entalent/config';

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private _client!: DbClient;

  constructor(@Inject(ConfigService) private readonly config: ConfigService<Env, true>) {}

  onModuleInit(): void {
    const url = this.config.get('DATABASE_URL', { infer: true });
    this._client = createDbClient(url);
  }

  async onModuleDestroy(): Promise<void> {
    await this._client.sql.end();
  }

  get client(): DbClient['db'] {
    return this._client.db;
  }
}
