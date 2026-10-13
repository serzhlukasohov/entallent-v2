import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { auditLogs, createDbClient, tenants } from '@entalent/database';
import { DatabaseService } from '../../database/database.service';
import { AuditLogRepository } from './audit-log.repository';

const databaseUrl = process.env['DATABASE_URL'];
const enabled = process.env['V2_CONVERSATION_QUEUE_TEST'] === '1' && !!databaseUrl;

describe.skipIf(!enabled)('idempotent audit entry on migrated PostgreSQL', () => {
  it('records one escalation per inbound within a tenant', async () => {
    const target = new URL(databaseUrl!);
    if (!['127.0.0.1', 'localhost'].includes(target.hostname) || !target.port) {
      throw new Error('isolated_postgres_required');
    }
    const client = createDbClient(databaseUrl!);
    const database = new DatabaseService({ get: () => databaseUrl } as never);
    database.onModuleInit();
    let tenantId: string | undefined;
    try {
      const db = client.db;
      const [tenant] = await db.insert(tenants)
        .values({ name: `Audit fixture ${randomUUID()}` }).returning();
      tenantId = tenant!.id;
      const repository = new AuditLogRepository(database);
      const input = {
        tenantId,
        actorType: 'system' as const,
        actorId: 'safety-policy-engine',
        action: 'escalation.raised',
        resourceType: 'user',
        resourceId: 'user-1',
        idempotencyKey: 'risk:inbound-1',
      };

      const concurrent = await Promise.all(Array.from({ length: 8 }, () =>
        repository.append(input)));
      expect(concurrent.filter(Boolean)).toHaveLength(1);
      expect(await repository.append(input)).toBe(false);
      expect(await repository.append({ ...input, idempotencyKey: 'risk:inbound-2' }))
        .toBe(true);
      const rows = await db.select().from(auditLogs).where(eq(auditLogs.tenantId, tenantId));
      expect(rows.map((row) => row.idempotencyKey).sort())
        .toEqual(['risk:inbound-1', 'risk:inbound-2']);
    } finally {
      if (tenantId) await client.db.delete(tenants).where(eq(tenants.id, tenantId));
      await database.onModuleDestroy();
      await client.sql.end({ timeout: 2 });
    }
  });
});
