import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
  conversations, conversationTurnTraces, createDbClient, featureFlags, messages, tenants, users,
} from '@entalent/database';
import { decryptField } from '@entalent/crypto-utils';
import { LocalEncryptionAdapter } from '../crypto/local-encryption.adapter';
import type { DatabaseService } from '../database/database.service';
import { ConversationTraceRepository, CONVERSATION_TRACE_FLAG } from './conversation-trace.repository';
import { ConversationTracePurgeProcessor } from './conversation-trace-purge.processor';

const databaseUrl = process.env['DATABASE_URL'];
const KEY = 'b'.repeat(64);

describe.skipIf(!databaseUrl)('conversation trace storage on migrated PostgreSQL', () => {
  it('honours only a tenant row of the switch, stores ciphertext and purges after 30 days', async () => {
    const target = new URL(databaseUrl!);
    if (!['127.0.0.1', 'localhost'].includes(target.hostname) || !target.port) {
      throw new Error('isolated_postgres_required');
    }
    const client = createDbClient(databaseUrl!);
    const db = client.db;
    const [tenant] = await db.insert(tenants).values({ name: `Trace ${randomUUID()}` }).returning();
    const globalFlagKey = CONVERSATION_TRACE_FLAG;
    try {
      const repository = new ConversationTraceRepository(
        { rootClient: db, client: db } as unknown as DatabaseService,
        new LocalEncryptionAdapter({ get: () => KEY } as never),
      );
      const [globalFlag] = await db.insert(featureFlags).values({ key: globalFlagKey, tenantId: null, enabled: true }).returning();
      try {
        expect(await repository.isTracingEnabled(tenant!.id)).toBe(false);
      } finally {
        await db.delete(featureFlags).where(eq(featureFlags.id, globalFlag!.id));
      }
      await db.insert(featureFlags).values({ key: CONVERSATION_TRACE_FLAG, tenantId: tenant!.id, enabled: true });
      expect(await repository.isTracingEnabled(tenant!.id)).toBe(true);

      const [user] = await db.insert(users).values({ tenantId: tenant!.id }).returning();
      const [conversation] = await db.insert(conversations).values({
        tenantId: tenant!.id, userId: user!.id, channelType: 'slack', externalConversationId: `D${randomUUID()}`,
      }).returning();
      const [inbound] = await db.insert(messages).values({
        tenantId: tenant!.id, conversationId: conversation!.id, userId: user!.id,
        direction: 'inbound', senderType: 'user', text: 'hello', occurredAt: new Date(),
      }).returning();
      const row = {
        tenantId: tenant!.id, userId: user!.id, conversationId: conversation!.id, inboundMessageId: inbound!.id,
        outboundMessageId: null, traceId: 't', status: 'completed' as const, schemaVersion: 1,
        payloadJson: '{"userMessage":"hello"}', startedAt: new Date(), completedAt: new Date(),
      };
      await repository.insert(row);
      await repository.insert(row);
      const stored = await db.select().from(conversationTurnTraces).where(eq(conversationTurnTraces.tenantId, tenant!.id));
      expect(stored).toHaveLength(2);
      expect(stored[0]!.payloadEncrypted).not.toContain('hello');
      expect(decryptField(stored[0]!.payloadEncrypted, KEY)).toBe(row.payloadJson);

      const now = new Date();
      const day = 24 * 60 * 60 * 1000;
      await db.update(conversationTurnTraces).set({ createdAt: new Date(now.getTime() - 31 * day) })
        .where(eq(conversationTurnTraces.id, stored[0]!.id));
      await db.update(conversationTurnTraces).set({ createdAt: new Date(now.getTime() - 29 * day) })
        .where(eq(conversationTurnTraces.id, stored[1]!.id));
      const purge = new ConversationTracePurgeProcessor(repository, {} as never);
      await purge.purge(now);
      const left = await db.select({ id: conversationTurnTraces.id }).from(conversationTurnTraces)
        .where(eq(conversationTurnTraces.tenantId, tenant!.id));
      expect(left.map((item) => item.id)).toEqual([stored[1]!.id]);
    } finally {
      await db.delete(tenants).where(eq(tenants.id, tenant!.id));
      await client.sql.end();
    }
  });
});
