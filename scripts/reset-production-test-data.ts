import IORedis from 'ioredis';
import { Queue } from 'bullmq';
import { getDbClient } from '@entalent/database';
import { ALL_QUEUE_NAMES } from '@entalent/contracts';

type ResetMode = 'dry-run' | 'execute';

interface TablePlan {
  table: string;
  where: string;
}

const PRODUCT_TABLES: readonly TablePlan[] = [
  { table: 'runtime_actions', where: 'tenant_id = $1::uuid' },
  { table: 'runtime_shadow_diagnostics', where: 'tenant_id = $1::uuid' },
  { table: 'runtime_attempts', where: 'tenant_id = $1::uuid' },
  { table: 'audit_logs', where: 'tenant_id = $1::uuid' },
  { table: 'llm_runs', where: 'tenant_id = $1::uuid' },
  { table: 'pulse_backlog', where: 'tenant_id = $1::uuid' },
  { table: 'survey_group_states', where: 'tenant_id = $1::uuid' },
  { table: 'survey_assessments', where: 'survey_window_id IN (SELECT id FROM survey_windows WHERE tenant_id = $1::uuid)' },
  { table: 'survey_evidence', where: 'survey_window_id IN (SELECT id FROM survey_windows WHERE tenant_id = $1::uuid)' },
  { table: 'survey_windows', where: 'tenant_id = $1::uuid' },
  { table: 'scheduled_actions', where: 'tenant_id = $1::uuid' },
  { table: 'risk_signals', where: 'tenant_id = $1::uuid' },
  { table: 'user_goals', where: 'tenant_id = $1::uuid' },
  { table: 'memory_items', where: 'tenant_id = $1::uuid' },
  { table: 'user_style_profiles', where: 'tenant_id = $1::uuid' },
  { table: 'messages', where: 'tenant_id = $1::uuid' },
  { table: 'conversations', where: 'tenant_id = $1::uuid' },
  { table: 'channel_accounts', where: 'tenant_id = $1::uuid' },
  { table: 'users', where: 'tenant_id = $1::uuid' },
];

const PRESERVED_TABLES = [
  'tenants',
  'feature_flags',
  'workspace_connections',
  'survey_definitions',
  'survey_questions',
  'teams',
];

async function main(): Promise<void> {
  const tenantId = process.env.TENANT_ID ?? process.env.DEFAULT_TENANT_ID;
  const mode = resolveMode();
  if (!tenantId) {
    throw new Error('TENANT_ID or DEFAULT_TENANT_ID is required.');
  }
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required.');
  }
  if (!looksLikeUuid(tenantId)) {
    throw new Error(`Tenant id must be a UUID, got: ${tenantId}`);
  }

  if (mode === 'execute' && process.env.CONFIRM_PRODUCTION_TEST_RESET !== tenantId) {
    throw new Error(
      'Refusing destructive reset. Set CONFIRM_PRODUCTION_TEST_RESET exactly equal to TENANT_ID.',
    );
  }

  const db = getDbClient();
  try {
    await assertTenantExists(tenantId);
    const rows = await collectTableCounts(tenantId);
    const queueRows = await collectQueueCounts(mode);
    printPlan({ tenantId, mode, rows, queueRows });

    if (mode === 'dry-run') {
      return;
    }

    await resetQueues();
    const deletedRows = await deleteProductRows(tenantId);
    printResult({ tenantId, deletedRows });
  } finally {
    await db.sql.end({ timeout: 2 }).catch(() => undefined);
  }
}

function resolveMode(): ResetMode {
  const value = process.env.RESET_MODE ?? 'dry-run';
  if (value === 'dry-run' || value === 'execute') {
    return value;
  }
  throw new Error("RESET_MODE must be 'dry-run' or 'execute'.");
}

async function assertTenantExists(tenantId: string): Promise<void> {
  const { sql } = getDbClient();
  const rows = await sql<{ count: string }[]>`
    SELECT count(*)::text AS count
    FROM tenants
    WHERE id = ${tenantId}::uuid
  `;
  if (rows[0]?.count !== '1') {
    throw new Error(`Tenant not found: ${tenantId}`);
  }
}

async function collectTableCounts(tenantId: string): Promise<Array<{ table: string; count: number }>> {
  const { sql } = getDbClient();
  const rows: Array<{ table: string; count: number }> = [];
  for (const plan of PRODUCT_TABLES) {
    const result = await sql.unsafe<{ count: string }[]>(
      `SELECT count(*)::text AS count FROM ${quoteIdentifier(plan.table)} WHERE ${plan.where}`,
      [tenantId],
    );
    rows.push({ table: plan.table, count: Number(result[0]?.count ?? 0) });
  }
  return rows;
}

async function deleteProductRows(tenantId: string): Promise<Array<{ table: string; deleted: number }>> {
  const { sql } = getDbClient();
  const deletedRows: Array<{ table: string; deleted: number }> = [];
  await sql.begin(async (tx) => {
    for (const plan of PRODUCT_TABLES) {
      const result = await tx.unsafe<{ count: string }[]>(
        `WITH deleted AS (
           DELETE FROM ${quoteIdentifier(plan.table)}
           WHERE ${plan.where}
           RETURNING 1
         )
         SELECT count(*)::text AS count FROM deleted`,
        [tenantId],
      );
      deletedRows.push({ table: plan.table, deleted: Number(result[0]?.count ?? 0) });
    }
  });
  return deletedRows;
}

async function collectQueueCounts(mode: ResetMode): Promise<Array<{ queue: string; counts: Record<string, number> }>> {
  if (!process.env.REDIS_URL) {
    return [];
  }
  const connection = createRedis(process.env.REDIS_URL);
  const queues = ALL_QUEUE_NAMES.map((name) => new Queue(name, { connection }));
  try {
    const rows: Array<{ queue: string; counts: Record<string, number> }> = [];
    for (const queue of queues) {
      rows.push({ queue: queue.name, counts: await queue.getJobCounts() });
    }
    return rows;
  } finally {
    await Promise.all(queues.map((queue) => queue.close().catch(() => undefined)));
    await connection.quit().catch(() => undefined);
  }
}

async function resetQueues(): Promise<void> {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    return;
  }
  const connection = createRedis(redisUrl);
  const queues = ALL_QUEUE_NAMES.map((name) => new Queue(name, { connection }));
  try {
    for (const queue of queues) {
      await queue.obliterate({ force: true });
    }
  } finally {
    await Promise.all(queues.map((queue) => queue.close().catch(() => undefined)));
    await connection.quit().catch(() => undefined);
  }
}

function createRedis(redisUrl: string): IORedis {
  const parsed = new URL(redisUrl);
  return new IORedis({
    host: parsed.hostname,
    port: Number(parsed.port) || 6379,
    ...(parsed.password ? { password: decodeURIComponent(parsed.password) } : {}),
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
}

function printPlan(input: {
  tenantId: string;
  mode: ResetMode;
  rows: Array<{ table: string; count: number }>;
  queueRows: Array<{ queue: string; counts: Record<string, number> }>;
}): void {
  process.stdout.write(
    `${JSON.stringify(
      {
        status: input.mode === 'dry-run' ? 'dry_run' : 'ready_to_execute',
        tenantId: input.tenantId,
        preservedTables: PRESERVED_TABLES,
        productRows: input.rows,
        queues: input.queueRows,
        executeWith:
          input.mode === 'dry-run'
            ? `RESET_MODE=execute CONFIRM_PRODUCTION_TEST_RESET=${input.tenantId}`
            : undefined,
      },
      null,
      2,
    )}\n`,
  );
}

function printResult(input: {
  tenantId: string;
  deletedRows: Array<{ table: string; deleted: number }>;
}): void {
  process.stdout.write(
    `${JSON.stringify(
      {
        status: 'reset_complete',
        tenantId: input.tenantId,
        deletedRows: input.deletedRows,
        queues: 'obliterated',
        preservedTables: PRESERVED_TABLES,
      },
      null,
      2,
    )}\n`,
  );
}

function quoteIdentifier(value: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(value)) {
    throw new Error(`Unsafe SQL identifier: ${value}`);
  }
  return `"${value}"`;
}

function looksLikeUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
