import { createDbClient } from '@entalent/database';
import { RetentionCleanupUseCase } from '@entalent/application';
import { RetentionRepository } from '../apps/worker/src/retention/retention.repository';

export interface RetentionCleanupConfig {
  databaseUrl: string;
  tenantId?: string;
  now: Date;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OFFSET_INSTANT_PATTERN = /T.*(?:Z|[+-]\d{2}:\d{2})$/;

export function parseRetentionCleanupConfig(env: NodeJS.ProcessEnv): RetentionCleanupConfig {
  const tenantId = env['TENANT_ID']?.trim() || undefined;
  if (tenantId && !UUID_PATTERN.test(tenantId)) {
    throw new Error('TENANT_ID must be a UUID');
  }
  return {
    databaseUrl: required(env, 'DATABASE_URL'),
    ...(tenantId ? { tenantId } : {}),
    now: parseInstant(env['RETENTION_CLEANUP_AT']?.trim() || new Date().toISOString(), 'RETENTION_CLEANUP_AT'),
  };
}

async function main(): Promise<void> {
  const config = parseRetentionCleanupConfig(process.env);
  const client = createDbClient(config.databaseUrl);
  try {
    const repository = new RetentionRepository({ client: client.db } as never, config.tenantId);
    const result = await new RetentionCleanupUseCase(repository).execute({ now: config.now });
    console.log(JSON.stringify({
      tenantId: config.tenantId ?? null,
      cleanupAt: config.now.toISOString(),
      ...result,
    }, null, 2));
  } finally {
    await client.sql.end({ timeout: 2 }).catch(() => undefined);
  }
}

function required(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key]?.trim();
  if (!value) throw new Error(`${key} is required`);
  return value;
}

function parseInstant(value: string, key: string): Date {
  if (!OFFSET_INSTANT_PATTERN.test(value)) {
    throw new Error(`${key} must be an ISO-8601 instant with an explicit offset`);
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new Error(`${key} must be a valid instant`);
  return parsed;
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
