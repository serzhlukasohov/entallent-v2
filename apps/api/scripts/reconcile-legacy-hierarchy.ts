import { sql } from 'drizzle-orm';
import { createDbClient } from '@entalent/database';
import { reconcileLegacyHierarchy } from '../src/hierarchy/legacy-reconciliation';
import { readLegacyHierarchyInput } from '../src/hierarchy/legacy-reconciliation.read';

async function main(): Promise<void> {
  const tenantId = process.env['TENANT_ID'];
  const databaseUrl = process.env['DATABASE_URL'];
  if (!tenantId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(tenantId)) {
    throw new Error('TENANT_ID must be the explicit tenant UUID');
  }
  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  const client = createDbClient(databaseUrl);
  try {
    const input = await client.db.transaction(async (tx) => {
      await tx.execute(sql`SET TRANSACTION READ ONLY`);
      return readLegacyHierarchyInput(tx, tenantId);
    }, { isolationLevel: 'repeatable read' });
    process.stdout.write(`${JSON.stringify(reconcileLegacyHierarchy(input), null, 2)}\n`);
  } finally {
    await client.sql.end();
  }
}

main().catch((error: unknown) => {
  const code = typeof error === 'object' && error !== null && 'code' in error &&
    typeof error.code === 'string' ? error.code : null;
  const message = error instanceof Error && error.message
    ? error.message : code ?? 'Legacy hierarchy reconciliation failed';
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
