import { randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
  conversations, conversationTurnTraces, createDbClient, featureFlags, messages, tenants, users,
} from '@entalent/database';
import type { DatabaseService } from '../database/database.service';
import { ConversationTraceReader, TEST_TENANT_FLAG } from './conversation-trace.reader';

const databaseUrl = process.env['DATABASE_URL'];

describe.skipIf(!databaseUrl)('conversation trace reader on migrated PostgreSQL', () => {
  it('reads only the requested tenant, pages newest first and numbers export turns', async () => {
    const target = new URL(databaseUrl!);
    if (!['127.0.0.1', 'localhost'].includes(target.hostname) || !target.port) {
      throw new Error('isolated_postgres_required');
    }
    const client = createDbClient(databaseUrl!);
    const db = client.db;
    const tenantIds: string[] = [];
    const globalFlagIds: string[] = [];
    try {
      const seed = async (count: number) => {
        const [tenant] = await db.insert(tenants).values({ name: `Trace read ${randomUUID()}` }).returning();
        tenantIds.push(tenant!.id);
        const [user] = await db.insert(users).values({ tenantId: tenant!.id }).returning();
        const [conversation] = await db.insert(conversations).values({
          tenantId: tenant!.id, userId: user!.id, channelType: 'slack', externalConversationId: `D${randomUUID()}`,
        }).returning();
        const base = Date.now() - 60 * 60 * 1000;
        for (let i = 0; i < count; i += 1) {
          const [inbound] = await db.insert(messages).values({
            tenantId: tenant!.id, conversationId: conversation!.id, userId: user!.id,
            direction: 'inbound', senderType: 'user', text: `m${i}`, occurredAt: new Date(base + i * 1000),
          }).returning();
          await db.insert(conversationTurnTraces).values({
            tenantId: tenant!.id, userId: user!.id, conversationId: conversation!.id, inboundMessageId: inbound!.id,
            status: 'completed', schemaVersion: 1, payloadEncrypted: `cipher-${i}`,
            startedAt: new Date(base + i * 1000), completedAt: new Date(base + i * 1000 + 500),
          });
        }
        return { tenantId: tenant!.id, conversationId: conversation!.id };
      };
      const a = await seed(5);
      const b = await seed(2);
      const reader = new ConversationTraceReader({ client: db } as unknown as DatabaseService);
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

      const first = await reader.page(a.tenantId, since, null, 3);
      expect(first.map((row) => row.payloadEncrypted)).toEqual(['cipher-4', 'cipher-3', 'cipher-2']);
      const last = first.at(-1)!;
      const second = await reader.page(a.tenantId, since, { startedAt: last.startedAt, id: last.id }, 3);
      expect(second.map((row) => row.payloadEncrypted)).toEqual(['cipher-1', 'cipher-0']);

      const exported = await reader.conversation(a.tenantId, a.conversationId, 2);
      expect(exported.rows.map((row) => row.payloadEncrypted)).toEqual(['cipher-3', 'cipher-4']);
      expect(exported.olderCount).toBe(3);
      await expect(reader.conversation(a.tenantId, b.conversationId, 10)).resolves.toEqual({ rows: [], olderCount: 0 });
      expect((await reader.page(b.tenantId, since, null, 10)).map((row) => row.conversationId)).toEqual([b.conversationId, b.conversationId]);

      // Single-row lookup is tenant-scoped; the test-tenant marker counts only as a tenant-specific row.
      expect((await reader.turn(a.tenantId, last.id))?.payloadEncrypted).toBe('cipher-2');
      await expect(reader.turn(b.tenantId, last.id)).resolves.toBeNull();
      await expect(reader.testTenantSince(a.tenantId)).resolves.toBeNull();
      const [globalFlag] = await db.insert(featureFlags).values({ key: TEST_TENANT_FLAG, tenantId: null, enabled: true }).returning();
      globalFlagIds.push(globalFlag!.id);
      await expect(reader.testTenantSince(a.tenantId)).resolves.toBeNull();
      const marked = new Date(Date.now() - 10 * 60_000);
      await db.insert(featureFlags).values({ key: TEST_TENANT_FLAG, tenantId: a.tenantId, enabled: true, updatedAt: marked });
      await expect(reader.testTenantSince(a.tenantId)).resolves.toEqual(marked);
      await expect(reader.testTenantSince(b.tenantId)).resolves.toBeNull();
      // (key, tenant_id) is unique, so unmarking and re-marking update the one row; re-marking moves the mark later.
      const markerOf = (tenantId: string) => and(eq(featureFlags.key, TEST_TENANT_FLAG), eq(featureFlags.tenantId, tenantId));
      await db.update(featureFlags).set({ enabled: false, updatedAt: new Date() }).where(markerOf(a.tenantId));
      await expect(reader.testTenantSince(a.tenantId)).resolves.toBeNull();
      const remarked = new Date();
      await db.update(featureFlags).set({ enabled: true, updatedAt: remarked }).where(markerOf(a.tenantId));
      await expect(reader.testTenantSince(a.tenantId)).resolves.toEqual(remarked);
      await expect(db.insert(featureFlags).values({ key: TEST_TENANT_FLAG, tenantId: a.tenantId, enabled: false })).rejects.toThrow();
    } finally {
      // The global marker row has no tenant to cascade from.
      if (globalFlagIds.length) await db.delete(featureFlags).where(inArray(featureFlags.id, globalFlagIds));
      if (tenantIds.length) await db.delete(tenants).where(inArray(tenants.id, tenantIds));
      await client.sql.end();
    }
  });
});
