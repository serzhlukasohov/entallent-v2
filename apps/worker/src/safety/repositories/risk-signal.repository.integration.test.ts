import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { conversations, createDbClient, messages, riskSignals, tenants, users } from '@entalent/database';
import { DatabaseService } from '../../database/database.service';
import { RiskSignalRepository } from './risk-signal.repository';

const databaseUrl = process.env['DATABASE_URL'];
const enabled = process.env['V2_CONVERSATION_QUEUE_TEST'] === '1' && !!databaseUrl;

describe.skipIf(!enabled)('source-scoped risk signal on migrated PostgreSQL', () => {
  it('retains one signal per inbound and rejects a foreign person or evidence source', async () => {
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
      const [tenant] = await db.insert(tenants).values({ name: `Risk fixture ${randomUUID()}` }).returning();
      tenantId = tenant!.id;
      const [user, otherUser] = await db.insert(users).values([
        { tenantId }, { tenantId },
      ]).returning();
      const [conversation, otherConversation] = await db.insert(conversations).values([
        { tenantId, userId: user!.id, channelType: 'dev', externalConversationId: randomUUID() },
        { tenantId, userId: otherUser!.id, channelType: 'dev', externalConversationId: randomUUID() },
      ]).returning();
      const [inbound, foreignInbound, outbound] = await db.insert(messages).values([
        { tenantId, userId: user!.id, conversationId: conversation!.id,
          direction: 'inbound', senderType: 'user', text: 'Private safety source', occurredAt: new Date() },
        { tenantId, userId: otherUser!.id, conversationId: otherConversation!.id,
          direction: 'inbound', senderType: 'user', text: 'Foreign private source', occurredAt: new Date() },
        { tenantId, userId: user!.id, conversationId: conversation!.id,
          direction: 'outbound', senderType: 'agent', text: 'Not an inbound', occurredAt: new Date() },
      ]).returning();
      const repository = new RiskSignalRepository(database);
      const input = {
        tenantId, userId: user!.id, sourceMessageId: inbound!.id,
        type: 'potential_self_harm', severity: 'critical', confidence: 0.95,
        evidenceMessageIds: [inbound!.id], policyVersion: 'v1',
      };

      const concurrent = await Promise.all(Array.from({ length: 8 }, () =>
        repository.saveOnceForSource(input)));
      const first = concurrent[0]!;
      expect(new Set(concurrent.map((signal) => signal.id))).toEqual(new Set([first.id]));
      const repeated = await repository.saveOnceForSource({ ...input, confidence: 0.8 });
      expect(repeated.id).toBe(first.id);
      expect(await db.select().from(riskSignals).where(eq(riskSignals.tenantId, tenantId)))
        .toHaveLength(1);
      await expect(repository.saveOnceForSource({ ...input, userId: otherUser!.id }))
        .rejects.toThrow(/risk_signal_source_scope_mismatch/);
      await expect(repository.saveOnceForSource({
        ...input, sourceMessageId: outbound!.id, evidenceMessageIds: [outbound!.id],
      })).rejects.toThrow(/risk_signal_source_scope_mismatch/);
      await expect(repository.saveOnceForSource({
        ...input, sourceMessageId: foreignInbound!.id,
        evidenceMessageIds: [foreignInbound!.id],
      })).rejects.toThrow(/risk_signal_source_scope_mismatch/);
      await expect(db.update(riskSignals).set({ sourceMessageId: foreignInbound!.id })
        .where(eq(riskSignals.id, first.id)))
        .rejects.toThrow(/risk_signal_source_immutable/);
      expect(await db.select().from(riskSignals).where(eq(riskSignals.tenantId, tenantId)))
        .toHaveLength(1);
    } finally {
      if (tenantId) await client.db.delete(tenants).where(eq(tenants.id, tenantId));
      await database.onModuleDestroy();
      await client.sql.end({ timeout: 2 });
    }
  });
});
