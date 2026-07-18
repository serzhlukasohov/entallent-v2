import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import path from 'path';

async function runMigrations(): Promise<void> {
  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) {
    throw new Error('DATABASE_URL environment variable is required');
  }

  const sql = postgres(databaseUrl, { max: 1 });
  const db = drizzle(sql);

  const migrationsFolder = path.resolve(__dirname, '..', 'migrations');

  console.log(`Running migrations from ${migrationsFolder}`);

  await migrate(db, { migrationsFolder });

  console.log('Migrations completed successfully');

  await sql.end();
}

runMigrations().catch((error: unknown) => {
  console.error('Migration failed:', error);
  process.exit(1);
});
