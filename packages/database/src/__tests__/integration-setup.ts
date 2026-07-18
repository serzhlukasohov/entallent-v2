import { describe } from 'vitest';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import path from 'path';
import * as schema from '../schema';

export type TestDb = ReturnType<typeof drizzle<typeof schema>>;
export type TestSql = ReturnType<typeof postgres>;

let _sql: TestSql | undefined;
let _db: TestDb | undefined;

export function getTestDb(): { db: TestDb; sql: TestSql } {
  if (!_sql || !_db) {
    const url = process.env['DATABASE_URL'];
    if (!url) {
      throw new Error('DATABASE_URL is required for integration tests');
    }
    _sql = postgres(url, { max: 5 });
    _db = drizzle(_sql, { schema });
  }
  return { db: _db, sql: _sql };
}

export async function runMigrationsOnce(): Promise<void> {
  const { sql } = getTestDb();
  const migrationsFolder = path.resolve(__dirname, '../../migrations');
  const migrationDb = drizzle(sql);
  await migrate(migrationDb, { migrationsFolder });
}

export async function closeTestDb(): Promise<void> {
  if (_sql) {
    await _sql.end();
    _sql = undefined;
    _db = undefined;
  }
}

/** Skip the whole describe block if DATABASE_URL is not set (local dev without Docker). */
export function describeIntegration(label: string, fn: () => void): void {
  const hasDb = Boolean(process.env['DATABASE_URL']);
  (hasDb ? describe : describe.skip)(label, fn);
}
