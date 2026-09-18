import { describe, expect, it, vi } from 'vitest';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import {
  ConversationRepository,
  isNewerInboundWithinWindow,
  toConversationActiveTopic,
} from './conversation.repository';

function createDbMock(rows: unknown[]) {
  const limit = vi.fn().mockResolvedValue(rows);
  const orderBy = vi.fn((..._values: unknown[]) => ({ limit }));
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
  it('finds a newer inbound only inside the queued tenant, user, conversation, and window', async () => {
    const occurredAt = new Date('2026-09-11T00:16:26.984Z');
    const candidate = {
      id: 'message-2',
      occurredAt: new Date('2026-09-11T00:16:28.641Z'),
      externalMessageId: '1789078588.641019',
    };
    const db = createAdmissionDbMock(
      [{ id: 'message-1', occurredAt, externalMessageId: '1789078586.984529' }],
      [candidate],
    );
    const repository = new ConversationRepository(db.client as never);

    await expect(repository.shouldSkipInboundMessage({
      messageId: 'message-1',
      tenantId: 'tenant-1',
      userId: 'user-1',
      conversationId: 'conversation-1',
      windowMs: 2_000,
    })).resolves.toBe(true);

    const anchorQuery = compileSql(db.calls.where.mock.calls[0]?.[0]);
    const candidateQuery = compileSql(db.calls.where.mock.calls[1]?.[0]);
    for (const query of [anchorQuery, candidateQuery]) {
      expect(query.sql).toContain('"messages"."tenant_id"');
      expect(query.sql).toContain('"messages"."user_id"');
      expect(query.sql).toContain('"messages"."conversation_id"');
      expect(query.sql).toContain('"messages"."direction"');
      expect(query.sql).toContain('"messages"."deleted_at" is null');
    }
    expect(anchorQuery.sql).toContain('"messages"."id"');
    expect(anchorQuery.params).toEqual(expect.arrayContaining([
      'tenant-1',
      'user-1',
      'conversation-1',
      'inbound',
      'message-1',
    ]));
    expect(candidateQuery.sql).toContain('"messages"."id" <>');
    expect(candidateQuery.sql).toContain('"messages"."occurred_at" >=');
    expect(candidateQuery.sql).toContain('"messages"."occurred_at" <=');
    expect(candidateQuery.params).toContain(occurredAt.toISOString());
    expect(candidateQuery.params).toContain('2026-09-11T00:16:28.984Z');
    expect(candidateQuery.params).toEqual(expect.arrayContaining([
      'tenant-1',
      'user-1',
      'conversation-1',
      'inbound',
      'message-1',
    ]));
  });

  it('uses event time, Slack id, and persisted id as the total order for rolling bursts', () => {
    const at = (offsetMs: number, externalMessageId?: string, id = `message-${offsetMs}`) => ({
      id,
      occurredAt: new Date(Date.UTC(2026, 8, 11, 0, 0, 0, offsetMs)),
      externalMessageId,
    });

    expect(isNewerInboundWithinWindow(at(0), at(1_999), 2_000)).toBe(true);
    expect(isNewerInboundWithinWindow(at(1_999), at(3_998), 2_000)).toBe(true);
    expect(isNewerInboundWithinWindow(at(0), at(2_000), 2_000)).toBe(false);
    expect(isNewerInboundWithinWindow(at(0), at(2_001), 2_000)).toBe(false);
    expect(isNewerInboundWithinWindow(
      {
        ...at(0, '1789078586.000001', 'message-a'),
        occurredAt: new Date(1_789_078_586_000),
      },
      {
        ...at(2_000, '1789078588.000000', 'message-b'),
        occurredAt: new Date(1_789_078_588_000),
      },
      2_000,
    )).toBe(true);
    expect(isNewerInboundWithinWindow(
      at(0, '1789078586.984529', 'message-a'),
      at(0, '1789078586.984530', 'message-b'),
      2_000,
    )).toBe(true);
    expect(isNewerInboundWithinWindow(
      at(0, '1789078586.984530', 'message-b'),
      at(0, '1789078586.984529', 'message-a'),
      2_000,
    )).toBe(false);
    expect(isNewerInboundWithinWindow(
      at(0, undefined, 'message-a'),
      at(0, undefined, 'message-b'),
      2_000,
    )).toBe(true);
    expect(isNewerInboundWithinWindow(
      at(0, '1789078586.984529', 'message-a'),
      at(0, undefined, 'message-b'),
      2_000,
    )).toBe(true);

    const mixedIds = [
      at(0, '1789078586.984529', 'message-a'),
      at(0, undefined, 'message-b'),
      at(0, '1789078586.984530', 'message-c'),
    ];
    const tails = mixedIds.filter((anchor) =>
      !mixedIds.some((candidate) =>
        candidate !== anchor && isNewerInboundWithinWindow(anchor, candidate, 2_000)));
    expect(tails).toHaveLength(1);
    expect(tails[0]?.id).toBe('message-b');

    expect(isNewerInboundWithinWindow(
      { ...at(0), receivedAt: new Date('2026-09-11T00:00:02.000Z') },
      { ...at(1_000), receivedAt: new Date('2026-09-11T00:00:01.000Z') },
      2_000,
    )).toBe(true);
    expect(isNewerInboundWithinWindow(
      { ...at(0), receivedAt: new Date('2026-09-11T00:00:03.000Z') },
      { ...at(1_000), receivedAt: new Date('2026-09-11T00:00:01.000Z') },
      2_000,
    )).toBe(false);
  });

  it('skips a missing or scoped-out anchor without querying candidates', async () => {
    const db = createAdmissionDbMock([], []);
    const repository = new ConversationRepository(db.client as never);

    await expect(repository.shouldSkipInboundMessage({
      messageId: 'missing-message',
      tenantId: 'tenant-1',
      userId: 'user-1',
      conversationId: 'conversation-1',
      windowMs: 2_000,
    })).resolves.toBe(true);

    expect(db.calls.where).toHaveBeenCalledOnce();
  });

  it('orders conversation history by the same persisted total order', async () => {
    const occurredAt = new Date('2026-09-11T00:16:26.984Z');
    const row = (id: string, externalMessageId: string | null) => ({
      id,
      conversationId: 'conversation-1',
      tenantId: 'tenant-1',
      userId: 'user-1',
      direction: 'inbound',
      text: id,
      externalMessageId,
      externalThreadId: null,
      occurredAt,
      metadata: {},
    });
    const db = createDbMock([
      row('message-b', null),
      row('message-c', '1789078586.984530'),
      row('message-a', '1789078586.984529'),
    ]);
    const repository = new ConversationRepository(db as never);

    const result = await repository.findRecentMessages('conversation-1', 10);

    expect(result.map(({ id }) => id)).toEqual(['message-a', 'message-c', 'message-b']);
    expect(compileSql(db.calls.orderBy.mock.calls[0]?.[0]).sql)
      .toBe('"messages"."occurred_at" desc');
    expect(compileSql(db.calls.orderBy.mock.calls[0]?.[1]).sql)
      .toContain('coalesce("messages"."external_message_id", "messages"."id"::text) desc');
    expect(compileSql(db.calls.orderBy.mock.calls[0]?.[2]).sql)
      .toBe('"messages"."id" desc');
  });

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

function createAdmissionDbMock(
  anchorRows: Array<{
    id: string;
    occurredAt: Date;
    externalMessageId: string | null;
    receivedAt?: Date | null;
  }>,
  candidateRows: Array<{
    id: string;
    occurredAt: Date;
    externalMessageId: string | null;
    receivedAt?: Date | null;
  }>,
) {
  const anchorLimit = vi.fn().mockResolvedValue(anchorRows);
  const where = vi.fn()
    .mockReturnValueOnce({ limit: anchorLimit })
    .mockResolvedValueOnce(candidateRows);
  const from = vi.fn(() => ({ where }));
  const select = vi.fn(() => ({ from }));

  return {
    client: { client: { select } },
    calls: { select, from, where, anchorLimit },
  };
}

describe('toConversationActiveTopic', () => {
  it('accepts the owned JSON shape and rejects invalid or unbounded state', () => {
    expect(toConversationActiveTopic({
      summary: 'Ship Atlas',
      status: 'parked',
      startedAt: '2026-08-01T10:00:00.000Z',
    })).toEqual({
      summary: 'Ship Atlas',
      status: 'parked',
      startedAt: '2026-08-01T10:00:00.000Z',
    });
    expect(toConversationActiveTopic({
      summary: '😀'.repeat(500),
      status: 'active',
      startedAt: '2026-08-01T10:00:00.000Z',
    })?.summary).toBe('😀'.repeat(500));

    for (const invalid of [
      null,
      { summary: '', status: 'active', startedAt: '2026-08-01T10:00:00.000Z' },
      { summary: 'x'.repeat(501), status: 'active', startedAt: '2026-08-01T10:00:00.000Z' },
      { summary: '😀'.repeat(501), status: 'active', startedAt: '2026-08-01T10:00:00.000Z' },
      { summary: 'Ship Atlas', status: 'closed', startedAt: '2026-08-01T10:00:00.000Z' },
      { summary: 'Ship Atlas', status: 'active', startedAt: '2026-08-01' },
    ]) {
      expect(toConversationActiveTopic(invalid)).toBeUndefined();
    }
  });
});
