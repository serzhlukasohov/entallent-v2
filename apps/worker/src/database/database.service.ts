import { AsyncLocalStorage } from 'node:async_hooks';
import { Injectable, Inject, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createDbClient, type DbClient } from '@entalent/database';
import type { Env } from '@entalent/config';

@Injectable()
export class DatabaseService implements OnModuleDestroy, OnModuleInit {
  private _client!: DbClient;
  private readonly transactionContext = new AsyncLocalStorage<DbClient['db']>();

  constructor(@Inject(ConfigService) private readonly config: ConfigService<Env, true>) {}

  onModuleInit(): void {
    const url = this.config.get('DATABASE_URL', { infer: true });
    this._client = createDbClient(url);
  }

  async onModuleDestroy(): Promise<void> {
    await this._client.sql.end();
  }

  get client(): DbClient['db'] {
    return this.transactionContext.getStore() ?? this._client.db;
  }

  async withTransaction<T>(callback: () => Promise<T>): Promise<T> {
    return this.client.transaction(async (tx) =>
      this.transactionContext.run(tx as unknown as DbClient['db'], callback));
  }
}
