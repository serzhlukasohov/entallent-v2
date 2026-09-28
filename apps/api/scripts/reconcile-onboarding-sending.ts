import { createDbClient } from '@entalent/database';
import { reconcileSendingOnboarding } from '../src/hierarchy/onboarding-reconciliation';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function main(): Promise<void> {
  const tenantId = process.env['TENANT_ID'];
  const databaseUrl = process.env['DATABASE_URL'];
  const apply = process.argv.includes('--apply');
  if (process.argv.some((arg) => arg.startsWith('--') && arg !== '--apply')) throw new Error('unknown_argument');
  if (!tenantId || !UUID_RE.test(tenantId)) throw new Error('TENANT_ID must be the explicit tenant UUID');
  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  if (apply && process.env['CONFIRM_ONBOARDING_RECONCILIATION'] !== tenantId) {
    throw new Error('CONFIRM_ONBOARDING_RECONCILIATION must equal TENANT_ID for apply');
  }
  const operatorId = process.env['OPERATOR_ID'];
  if (apply && !operatorId?.trim()) throw new Error('OPERATOR_ID is required for apply');
  const client = createDbClient(databaseUrl);
  try {
    process.stdout.write(`${JSON.stringify(await reconcileSendingOnboarding(client.db, tenantId,
      { apply, operatorId }), null, 2)}\n`);
  } finally {
    await client.sql.end();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : 'Onboarding reconciliation failed'}\n`);
  process.exitCode = 1;
});
