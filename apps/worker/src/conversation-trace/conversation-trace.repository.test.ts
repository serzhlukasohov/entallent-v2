import { describe, expect, it } from 'vitest';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { decryptField } from '@entalent/crypto-utils';
import { LocalEncryptionAdapter } from '../crypto/local-encryption.adapter';
import type { DatabaseService } from '../database/database.service';
import { ConversationTraceRepository } from './conversation-trace.repository';

const KEY = 'a'.repeat(64);
const TENANT = '11111111-1111-4111-8111-111111111111';

describe('ConversationTraceRepository', () => {
  it('encrypts the payload with FIELD_ENCRYPTION_KEY and writes outside any turn transaction', async () => {
    const inserted: Array<Record<string, unknown>> = [];
    const transactionClient = { insert: () => { throw new Error('must not use the transaction client'); } };
    const db = {
      get client() { return transactionClient; },
      rootClient: { insert: () => ({ values: async (values: Record<string, unknown>) => { inserted.push(values); } }) },
    } as unknown as DatabaseService;
    const encryption = new LocalEncryptionAdapter({ get: () => KEY } as never);
    const repository = new ConversationTraceRepository(db, encryption);
    const payloadJson = JSON.stringify({ userMessage: 'secret employee text' });

    await repository.insert({
      tenantId: TENANT, userId: 'u', conversationId: 'c', inboundMessageId: 'i', outboundMessageId: null,
      traceId: null, status: 'completed', schemaVersion: 1, payloadJson,
      startedAt: new Date(), completedAt: new Date(),
    });

    const [row] = inserted;
    expect(JSON.stringify(row)).not.toContain('secret employee text');
    expect(row).not.toHaveProperty('payloadJson');
    expect(decryptField(String(row!['payloadEncrypted']), KEY)).toBe(payloadJson);
  });
});

describe('ConversationTraceRepository queries', () => {
  const dialect = new PgDialect();
  const render = (condition: unknown) => dialect.sqlToQuery(condition as SQL);

  /** Fake drizzle builder that keeps every `where` condition for rendering. */
  function capturingDb(rows: unknown[]) {
    const conditions: unknown[] = [];
    const chain: Record<string, unknown> = {};
    for (const method of ['select', 'from', 'orderBy', 'delete']) chain[method] = () => chain;
    chain['where'] = (condition: unknown) => { conditions.push(condition); return chain; };
    chain['limit'] = async () => rows;
    chain['returning'] = async () => rows;
    return { db: { rootClient: chain } as unknown as DatabaseService, conditions };
  }

  it('reads only the tenant row of the switch, never a global one', async () => {
    const { db, conditions } = capturingDb([{ enabled: true }]);
    const repository = new ConversationTraceRepository(db, new LocalEncryptionAdapter({ get: () => KEY } as never));
    await expect(repository.isTracingEnabled(TENANT)).resolves.toBe(true);
    const query = render(conditions[0]);
    expect(query.sql).toBe('("feature_flags"."key" = $1 and "feature_flags"."tenant_id" = $2)');
    expect(query.params).toEqual(['conversation_trace', TENANT]);
    expect(query.sql).not.toMatch(/is null/i);
  });

  it('treats a missing or disabled row as off', async () => {
    for (const rows of [[], [{ enabled: false }]]) {
      const { db } = capturingDb(rows);
      const repository = new ConversationTraceRepository(db, new LocalEncryptionAdapter({ get: () => KEY } as never));
      await expect(repository.isTracingEnabled(TENANT)).resolves.toBe(false);
    }
  });

  it('purges only rows created strictly before the cutoff', async () => {
    const { db, conditions } = capturingDb([{ id: 'a' }]);
    const repository = new ConversationTraceRepository(db, new LocalEncryptionAdapter({ get: () => KEY } as never));
    const cutoff = new Date('2026-10-02T00:00:00Z');
    await expect(repository.purgeCreatedBefore(cutoff, 10)).resolves.toBe(1);
    const select = render(conditions[0]);
    expect(select.sql).toBe('"conversation_turn_traces"."created_at" < $1');
    expect(select.params).toEqual([cutoff.toISOString()]);
  });
});
