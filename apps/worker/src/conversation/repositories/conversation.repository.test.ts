import { describe, expect, it, vi } from 'vitest';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { ConversationRepository } from './conversation.repository';

function createDbMock(rows: Array<{ shownAt: Date | null }>) {
  const limit = vi.fn().mockResolvedValue(rows);
  const orderBy = vi.fn((_value: unknown) => ({ limit }));
  const where = vi.fn((_value: unknown) => ({ orderBy }));
  const from = vi.fn(() => ({ where }));
  const select = vi.fn(() => ({ from }));

  return {
    client: { select },
    calls: { select, from, where, orderBy, limit },
  };
}

function compileSql(value: unknown) {
  return new PgDialect().sqlToQuery(value as SQL);
}

describe('ConversationRepository', () => {
  it('loads only an active outbound message in the queued tenant and conversation', async () => {
    const limit = vi.fn().mockResolvedValue([{
      text: 'persisted response',
      sentAt: null,
      channelType: 'slack',
      externalConversationId: 'channel-1',
    }]);
    const where = vi.fn((_value: unknown) => ({ limit }));
    const innerJoin = vi.fn((_table: unknown, _on: unknown) => ({ where }));
    const from = vi.fn(() => ({ innerJoin }));
    const select = vi.fn((_fields: unknown) => ({ from }));
    const repository = new ConversationRepository({ client: { select } } as never);
    const lookup = (repository as unknown as {
      findOutboundMessageForDelivery?: (
        messageId: string,
        tenantId: string,
        conversationId: string,
      ) => Promise<unknown>;
    }).findOutboundMessageForDelivery;

    expect(lookup).toEqual(expect.any(Function));
    await expect(lookup!.call(
      repository,
      'message-1',
      'tenant-1',
      'conversation-1',
    )).resolves.toEqual({
      text: 'persisted response',
      sentAt: null,
      channelType: 'slack',
      externalConversationId: 'channel-1',
    });

    expect(Object.keys(select.mock.calls[0]![0] as object)).toEqual([
      'text',
      'sentAt',
      'channelType',
      'externalConversationId',
    ]);
    const joinQuery = compileSql(innerJoin.mock.calls[0]?.[1]);
    expect(joinQuery.sql).toContain('"conversations"."id" = "messages"."conversation_id"');
    expect(joinQuery.sql).toContain('"conversations"."tenant_id" = "messages"."tenant_id"');

    const query = compileSql(where.mock.calls[0]?.[0]);
    expect(query.sql).toContain('"messages"."id"');
    expect(query.sql).toContain('"messages"."tenant_id"');
    expect(query.sql).toContain('"messages"."conversation_id"');
    expect(query.sql).toContain('"messages"."direction"');
    expect(query.sql).toContain('"messages"."deleted_at" is null');
    expect(query.params).toContain('outbound');
  });

  it('returns only the latest delivered disclosure for the requested tenant, user, and version', async () => {
    const shownAt = new Date('2026-09-03T10:00:00.000Z');
    const before = new Date('2026-09-03T10:05:00.000Z');
    const db = createDbMock([{ shownAt }]);
    const repository = new ConversationRepository(db as never);

    await expect(
      repository.findLatestDeliveredReportingDisclosure(
        'tenant-1',
        'user-1',
        'reporting-disclosure-v1',
        before,
      ),
    ).resolves.toEqual({
      version: 'reporting-disclosure-v1',
      shownAt,
    });

    const whereQuery = compileSql(db.calls.where.mock.calls[0]?.[0]);
    expect(whereQuery.sql).toContain('"messages"."tenant_id"');
    expect(whereQuery.sql).toContain('"messages"."user_id"');
    expect(whereQuery.sql).toContain('"messages"."direction"');
    expect(whereQuery.sql).toContain('"messages"."sent_at" is not null');
    expect(whereQuery.sql).toContain('"messages"."sent_at" <');
    expect(whereQuery.sql).toContain('"messages"."deleted_at" is null');
    expect(whereQuery.sql).toContain("'reportingDisclosureVersion'");
    expect(whereQuery.params).toEqual([
      'tenant-1',
      'user-1',
      'outbound',
      'reporting-disclosure-v1',
      before.toISOString(),
    ]);

    const orderQuery = compileSql(db.calls.orderBy.mock.calls[0]?.[0]);
    expect(orderQuery.sql).toBe('"messages"."sent_at" desc');
    expect(db.calls.limit).toHaveBeenCalledWith(1);
  });

  it('scopes delivery updates to the queued tenant and conversation', async () => {
    const firstDeliveredAt = new Date('2026-09-03T09:59:00.000Z');
    const returning = vi.fn().mockResolvedValue([{
      id: 'message-1',
      sentAt: firstDeliveredAt,
    }]);
    const where = vi.fn((_value: unknown) => ({ returning }));
    const set = vi.fn((_value: unknown) => ({ where }));
    const update = vi.fn(() => ({ set }));
    const repository = new ConversationRepository({ client: { update } } as never);

    await expect(repository.updateMessageDelivery('message-1', {
      tenantId: 'tenant-1',
      conversationId: 'conversation-1',
      externalMessageId: '1710000000.000001',
      sentAt: new Date('2026-09-03T10:00:00.000Z'),
    })).resolves.toEqual(firstDeliveredAt);

    const updateValues = set.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(updateValues['sentAt']).toEqual(new Date('2026-09-03T10:00:00.000Z'));
    expect(updateValues['externalMessageId']).toBe('1710000000.000001');

    const query = compileSql(where.mock.calls[0]?.[0]);
    expect(query.sql).toContain('"messages"."id"');
    expect(query.sql).toContain('"messages"."tenant_id"');
    expect(query.sql).toContain('"messages"."conversation_id"');
    expect(query.sql).toContain('"messages"."sent_at" is null');
    expect(query.sql).toContain('"messages"."deleted_at" is null');
    expect(query.params).toEqual(['message-1', 'tenant-1', 'conversation-1', 'outbound']);
  });

  it('rejects a delivery update when the queued scope matches no message', async () => {
    const returning = vi.fn().mockResolvedValue([]);
    const where = vi.fn((_value: unknown) => ({ returning }));
    const set = vi.fn((_value: unknown) => ({ where }));
    const update = vi.fn(() => ({ set }));
    const limit = vi.fn().mockResolvedValue([]);
    const selectWhere = vi.fn((_value: unknown) => ({ limit }));
    const from = vi.fn(() => ({ where: selectWhere }));
    const select = vi.fn(() => ({ from }));
    const repository = new ConversationRepository({ client: { update, select } } as never);

    await expect(repository.updateMessageDelivery('message-1', {
      tenantId: 'tenant-1',
      conversationId: 'conversation-1',
      externalMessageId: '1710000000.000001',
      sentAt: new Date('2026-09-03T10:00:00.000Z'),
    })).rejects.toThrow('Delivery update scope mismatch');
  });
});
