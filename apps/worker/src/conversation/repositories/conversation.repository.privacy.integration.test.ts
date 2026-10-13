import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { conversationJobReceipts, createDbClient, conversations, messages, tenants, users } from '@entalent/database';
import { ConversationRepository } from './conversation.repository';

const databaseUrl = process.env['DATABASE_URL'];
const localDatabase = databaseUrl && /^postgres(?:ql)?:\/\/(?:[^@]+@)?(?:127\.0\.0\.1|localhost):\d+\//.test(databaseUrl);

describe.skipIf(!localDatabase)('employee conversation history scope on migrated PostgreSQL', () => {
  const client = localDatabase ? createDbClient(databaseUrl!) : null;
  const repository = client ? new ConversationRepository({ client: client.db } as never) : null;
  const tenantIds: string[] = [];

  afterAll(async () => {
    if (!client) return;
    for (const tenantId of tenantIds) {
      await client.db.delete(tenants).where(eq(tenants.id, tenantId));
    }
    await client.sql.end({ timeout: 2 });
  });

  async function insertHistoricalMismatch(input: {
    tenantId: string; userId: string; conversationId: string;
    direction: 'inbound' | 'outbound'; text: string;
    occurredAt: Date; sentAt?: Date; metadata?: Record<string, unknown>;
  }): Promise<string> {
    const id = randomUUID();
    // Recreate a row written before migration 0032 without weakening the production guard.
    await client!.sql.begin(async (tx) => {
      await tx`set local session_replication_role = replica`;
      await tx`insert into messages (
        id, tenant_id, user_id, conversation_id, direction, sender_type,
        text, occurred_at, sent_at, metadata
      ) values (
        ${id}, ${input.tenantId}, ${input.userId}, ${input.conversationId},
        ${input.direction}, ${input.direction === 'inbound' ? 'user' : 'agent'},
        ${input.text}, ${input.occurredAt.toISOString()}, ${input.sentAt?.toISOString() ?? null},
        ${JSON.stringify(input.metadata ?? {})}::jsonb
      )`;
    });
    return id;
  }

  it('reuses one scoped outbound ID and rejects conflicting replay content', async () => {
    if (!client || !repository) return;
    const [tenant] = await client.db.insert(tenants).values({ name: `Turn identity ${randomUUID()}` }).returning();
    tenantIds.push(tenant!.id);
    const [person] = await client.db.insert(users).values({ tenantId: tenant!.id }).returning();
    const [conversation] = await client.db.insert(conversations).values({
      tenantId: tenant!.id, userId: person!.id,
      channelType: 'dev', externalConversationId: randomUUID(),
    }).returning();
    const [inbound, otherInbound] = await client.db.insert(messages).values([
      { tenantId: tenant!.id, userId: person!.id, conversationId: conversation!.id,
        direction: 'inbound' as const, senderType: 'user' as const,
        text: 'First request.', occurredAt: new Date() },
      { tenantId: tenant!.id, userId: person!.id, conversationId: conversation!.id,
        direction: 'inbound' as const, senderType: 'user' as const,
        text: 'Other request.', occurredAt: new Date() },
    ]).returning();
    const id = randomUUID();
    const params = {
      id, tenantId: tenant!.id, userId: person!.id, conversationId: conversation!.id,
      direction: 'outbound' as const, text: 'One response.',
      metadata: { sourceInboundMessageId: inbound!.id },
    };
    expect((await repository.saveMessage(params)).id).toBe(id);
    expect((await repository.saveMessage(params)).id).toBe(id);
    await expect(repository.saveMessage({ ...params, text: 'Different response.' }))
      .rejects.toThrow('Message idempotency scope mismatch');
    await expect(repository.saveMessage({ ...params, metadata: { sourceInboundMessageId: otherInbound!.id } }))
      .rejects.toThrow('Message idempotency scope mismatch');
    expect(await client.db.select().from(messages).where(eq(messages.id, id))).toHaveLength(1);
  });

  it('excludes a message whose tenant and user do not own the referenced conversation', async () => {
    if (!client || !repository) return;
    const [ownerTenant, otherTenant] = await client.db.insert(tenants).values([
      { name: `History owner ${randomUUID()}` },
      { name: `History other ${randomUUID()}` },
    ]).returning();
    tenantIds.push(ownerTenant!.id, otherTenant!.id);
    const [owner, other] = await client.db.insert(users).values([
      { tenantId: ownerTenant!.id },
      { tenantId: otherTenant!.id },
    ]).returning();
    const [conversation] = await client.db.insert(conversations).values({
      tenantId: ownerTenant!.id, userId: owner!.id,
      channelType: 'dev', externalConversationId: randomUUID(),
    }).returning();
    await client.db.insert(messages).values(
      { tenantId: ownerTenant!.id, userId: owner!.id, conversationId: conversation!.id,
        direction: 'inbound', senderType: 'user', text: 'Owner history.',
        occurredAt: new Date('2026-09-29T00:00:00Z') },
    );
    await insertHistoricalMismatch({
      tenantId: otherTenant!.id, userId: other!.id, conversationId: conversation!.id,
      direction: 'inbound', text: 'Other employee private history.',
      occurredAt: new Date('2026-09-29T00:01:00Z'),
    });

    const history = await repository.findRecentMessages(conversation!.id, 20);
    expect(history.map((message) => message.text)).toEqual(['Owner history.']);
  });

  it('rejects same-tenant messages attached to another employee conversation', async () => {
    if (!client || !repository) return;
    const [tenant] = await client.db.insert(tenants).values({ name: `History scope ${randomUUID()}` }).returning();
    tenantIds.push(tenant!.id);
    const [owner, other] = await client.db.insert(users).values([
      { tenantId: tenant!.id }, { tenantId: tenant!.id },
    ]).returning();
    const [ownerConversation, otherConversation] = await client.db.insert(conversations).values([
      { tenantId: tenant!.id, userId: owner!.id, channelType: 'dev', externalConversationId: randomUUID() },
      { tenantId: tenant!.id, userId: other!.id, channelType: 'dev', externalConversationId: randomUUID() },
    ]).returning();
    const [ownerMessage] = await client.db.insert(messages).values(
      { tenantId: tenant!.id, userId: owner!.id, conversationId: ownerConversation!.id,
        direction: 'inbound', senderType: 'user', text: 'Owner history.',
        occurredAt: new Date('2026-09-29T00:00:00Z') },
    ).returning();
    const forgedHistoryId = await insertHistoricalMismatch({
      tenantId: tenant!.id, userId: other!.id, conversationId: ownerConversation!.id,
      direction: 'inbound', text: 'Other user history.',
      occurredAt: new Date('2026-09-29T00:01:00Z'),
    });
    const forgedDisclosureId = await insertHistoricalMismatch({
      tenantId: tenant!.id, userId: owner!.id, conversationId: otherConversation!.id,
      direction: 'outbound', text: 'Forged disclosure.',
      metadata: { reportingDisclosureVersion: 'v2' },
      occurredAt: new Date('2026-09-29T00:02:00Z'), sentAt: new Date('2026-09-29T00:02:01Z'),
    });

    expect((await repository.findRecentMessages(ownerConversation!.id, 20)).map((message) => message.id))
      .toEqual([ownerMessage!.id]);
    await expect(repository.findMessageById(ownerMessage!.id, tenant!.id, ownerConversation!.id))
      .resolves.toMatchObject({ id: ownerMessage!.id });
    await expect(repository.findMessageById(forgedHistoryId, tenant!.id, ownerConversation!.id))
      .resolves.toBeNull();
    await expect(repository.findMessageById(forgedDisclosureId, tenant!.id, otherConversation!.id))
      .resolves.toBeNull();
    await expect(repository.findLatestDeliveredReportingDisclosure(
      tenant!.id, owner!.id, 'v2', new Date('2026-09-30T00:00:00Z'),
    )).resolves.toBeNull();
    await expect(repository.shouldSkipInboundMessage({
      messageId: forgedHistoryId, tenantId: tenant!.id, userId: other!.id,
      conversationId: ownerConversation!.id, windowMs: 2_000,
    })).resolves.toBe(true);
  });

  it('loads historical context through a delayed source after newer turns arrive', async () => {
    if (!client || !repository) return;
    const [tenant] = await client.db.insert(tenants).values({ name: `Delayed source ${randomUUID()}` }).returning();
    tenantIds.push(tenant!.id);
    const [person] = await client.db.insert(users).values({ tenantId: tenant!.id }).returning();
    const [conversation] = await client.db.insert(conversations).values({
      tenantId: tenant!.id, userId: person!.id,
      channelType: 'dev', externalConversationId: randomUUID(),
    }).returning();
    const start = Date.parse('2026-09-29T00:00:00Z');
    const [prior, sameTimePrior, source] = await client.db.insert(messages).values([
      { tenantId: tenant!.id, userId: person!.id, conversationId: conversation!.id,
        direction: 'outbound', senderType: 'agent', text: 'What is clear?', occurredAt: new Date(start) },
      { tenantId: tenant!.id, userId: person!.id, conversationId: conversation!.id,
        direction: 'inbound', senderType: 'user', text: 'Earlier same-time turn.',
        externalMessageId: '100.000000', occurredAt: new Date(start + 1_000) },
      { tenantId: tenant!.id, userId: person!.id, conversationId: conversation!.id,
        direction: 'inbound', senderType: 'user', text: 'The goals are clear.',
        externalMessageId: '100.000001', occurredAt: new Date(start + 1_000) },
    ]).returning();
    await client.db.insert(messages).values({
      tenantId: tenant!.id, userId: person!.id, conversationId: conversation!.id,
      direction: 'inbound', senderType: 'user', text: 'Same-time later turn.',
      externalMessageId: '100.000002', occurredAt: new Date(start + 1_000),
    });
    await client.db.insert(messages).values(Array.from({ length: 20 }, (_, index) => ({
      tenantId: tenant!.id, userId: person!.id, conversationId: conversation!.id,
      direction: 'inbound' as const, senderType: 'user' as const,
      text: `Later turn ${index}`, occurredAt: new Date(start + 2_000 + index * 1_000),
    })));

    expect((await repository.findRecentMessages(conversation!.id, 15)).some((m) => m.id === source!.id))
      .toBe(false);
    const history = await repository.findMessagesThrough({
      tenantId: tenant!.id, userId: person!.id, conversationId: conversation!.id,
      inboundMessageId: source!.id, limit: 15,
    });
    expect(history.map((message) => message.id)).toEqual([prior!.id, sameTimePrior!.id, source!.id]);
    await expect(repository.findMessagesThrough({
      tenantId: tenant!.id, userId: randomUUID(), conversationId: conversation!.id,
      inboundMessageId: source!.id, limit: 15,
    })).resolves.toEqual([]);
  });

  it('does not infer same-time order from UUIDs when external IDs are absent', async () => {
    if (!client || !repository) return;
    const [tenant] = await client.db.insert(tenants).values({ name: `Same-time source ${randomUUID()}` }).returning();
    tenantIds.push(tenant!.id);
    const [person] = await client.db.insert(users).values({ tenantId: tenant!.id }).returning();
    const [conversation] = await client.db.insert(conversations).values({
      tenantId: tenant!.id, userId: person!.id,
      channelType: 'dev', externalConversationId: randomUUID(),
    }).returning();
    const at = new Date('2026-09-29T00:00:01Z');
    const [prior] = await client.db.insert(messages).values({
      tenantId: tenant!.id, userId: person!.id, conversationId: conversation!.id,
      direction: 'outbound', senderType: 'agent', text: 'Earlier prompt',
      occurredAt: new Date(at.getTime() - 1_000),
    }).returning();
    const sameTimeMessages = [
      { id: '00000000-0000-4000-8000-000000000001', text: 'Ambiguous lower UUID' },
      { id: '80000000-0000-4000-8000-000000000002', text: 'Source turn' },
      { id: 'ffffffff-ffff-4fff-8fff-ffffffffffff', text: 'Ambiguous higher UUID' },
    ];
    await client.db.insert(messages).values(sameTimeMessages.map((message) => ({
      ...message, tenantId: tenant!.id, userId: person!.id, conversationId: conversation!.id,
      direction: 'inbound' as const, senderType: 'user' as const, occurredAt: at,
    })));
    const history = await repository.findMessagesThrough({
      tenantId: tenant!.id, userId: person!.id, conversationId: conversation!.id,
      inboundMessageId: sameTimeMessages[1]!.id, limit: 15,
    });
    expect(history.map((message) => message.id)).toEqual([prior!.id, sameTimeMessages[1]!.id]);
  });

  it('records one scoped content-free receipt only after an inbound job succeeds', async () => {
    if (!client || !repository) return;
    const [tenant] = await client.db.insert(tenants).values({ name: `Receipt ${randomUUID()}` }).returning();
    tenantIds.push(tenant!.id);
    const [person] = await client.db.insert(users).values({ tenantId: tenant!.id }).returning();
    const [conversation] = await client.db.insert(conversations).values({
      tenantId: tenant!.id, userId: person!.id,
      channelType: 'dev', externalConversationId: randomUUID(),
    }).returning();
    const [inbound, outbound] = await client.db.insert(messages).values([
      { tenantId: tenant!.id, userId: person!.id, conversationId: conversation!.id,
        direction: 'inbound', senderType: 'user', text: 'Private answer.',
        occurredAt: new Date('2026-09-28T18:22:00Z') },
      { tenantId: tenant!.id, userId: person!.id, conversationId: conversation!.id,
        direction: 'outbound', senderType: 'agent', text: 'Private prompt.',
        occurredAt: new Date('2026-09-28T18:21:00Z') },
    ]).returning();
    const scope = { messageId: inbound!.id, tenantId: tenant!.id,
      userId: person!.id, conversationId: conversation!.id };
    await expect(repository.markInboundConversationJobProcessed({
      ...scope, userId: randomUUID(),
    })).rejects.toThrow('conversation_job_receipt_scope_mismatch');
    await expect(repository.markInboundConversationJobProcessed({
      ...scope, messageId: outbound!.id,
    })).rejects.toThrow('conversation_job_receipt_scope_mismatch');
    expect(await client.db.select().from(conversationJobReceipts)
      .where(eq(conversationJobReceipts.messageId, inbound!.id))).toHaveLength(0);
    await repository.markInboundConversationJobProcessed(scope);
    await repository.markInboundConversationJobProcessed(scope);
    expect(await client.db.select().from(conversationJobReceipts)
      .where(eq(conversationJobReceipts.messageId, inbound!.id))).toHaveLength(1);
  });
});
