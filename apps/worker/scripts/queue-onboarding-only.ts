import { randomUUID } from 'node:crypto';
import { Queue } from 'bullmq';
import { createDbClient } from '@entalent/database';
import { QUEUE_NAMES } from '@entalent/contracts';

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function main(): Promise<void> {
  const tenantId = required('TENANT_ID');
  const unitId = required('UNIT_ID');
  const expectedPersonIds = required('EXPECTED_PERSON_IDS').split(',').map((id) => id.trim()).sort();
  if (expectedPersonIds.length === 0 || new Set(expectedPersonIds).size !== expectedPersonIds.length) {
    throw new Error('EXPECTED_PERSON_IDS must be distinct');
  }
  const db = createDbClient(required('DATABASE_URL'));
  try {
    const deliveries = await db.sql.begin(async (tx) => {
      await tx`SET TRANSACTION READ ONLY`;
      return tx`SELECT person_id, status FROM org_onboarding_deliveries
        WHERE tenant_id = ${tenantId} AND unit_id = ${unitId} ORDER BY person_id`;
    });
    const actualPersonIds = deliveries.map((delivery) => String(delivery.person_id)).sort();
    const ready = deliveries.every((delivery) => delivery.status === 'pending') &&
      JSON.stringify(actualPersonIds) === JSON.stringify(expectedPersonIds);
    process.stdout.write(`${JSON.stringify({ mode: process.argv.includes('--apply') ? 'apply' : 'dry_run',
      tenantId, unitId, personIds: actualPersonIds, ready })}\n`);
    if (!ready) throw new Error('onboarding intent set changed');
    if (!process.argv.includes('--apply')) return;
    if (process.env['CONFIRM_ONBOARDING_DISPATCH'] !== `${tenantId}:${unitId}`) {
      throw new Error('CONFIRM_ONBOARDING_DISPATCH must equal TENANT_ID:UNIT_ID');
    }
    const url = new URL(required('REDIS_URL'));
    const queue = new Queue(QUEUE_NAMES.PROACTIVE_SCAN, { connection: {
      host: url.hostname, port: Number(url.port) || 6379,
      db: Number(url.pathname.slice(1) || '0'),
      ...(url.password ? { password: decodeURIComponent(url.password) } : {}),
    } });
    try {
      const job = await queue.add('onboarding-only', { tenantId, unitId }, {
        jobId: `company-onboarding-${randomUUID()}`, attempts: 1,
      });
      process.stdout.write(`${JSON.stringify({ mode: 'queued', jobId: job.id,
        tenantId, unitId, personIds: actualPersonIds })}\n`);
    } finally {
      await queue.close();
    }
  } finally {
    await db.sql.end();
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : 'queue failed'}\n`);
  process.exitCode = 1;
});
