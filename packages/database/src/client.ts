import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from './schema';

export type DbClient = ReturnType<typeof createDbClient>;

export function createDbClient(databaseUrl: string) {
  const sql = postgres(databaseUrl, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
    onnotice: () => {
      // suppress notices in application code
    },
  });

  const db = drizzle(sql, { schema });

  return { db, sql };
}

let _client: DbClient | undefined;

export function getDbClient(databaseUrl?: string): DbClient {
  if (!_client) {
    const url = databaseUrl ?? process.env['DATABASE_URL'];
    if (!url) {
      throw new Error('DATABASE_URL is required to initialize the database client');
    }
    _client = createDbClient(url);
  }
  return _client;
}
