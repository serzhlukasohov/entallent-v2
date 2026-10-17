import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { conversationJobAdmissions, conversations, createDbClient, messages, tenants, users } from '@entalent/database';
import { IngestionService } from './ingestion.service';

const databaseUrl = process.env['DATABASE_URL'];
const localDatabase = databaseUrl && /^postgres(?:ql)?:\/\/(?:[^@]+@)?(?:127\.0\.0\.1|localhost):\d+\//.test(databaseUrl);

describe.skipIf(!localDatabase)('ingestion conversation ownership on migrated PostgreSQL', () => {
  const client = localDatabase ? createDbClient(databaseUrl!) : null;
  const service = client ? new IngestionService({ client: client.db } as never, {} as never) : null;
  const tenantIds: string[] = [];

  afterAll(async () => {
    if (!client) return;
    for (const tenantId of tenantIds) await client.db.delete(tenants).where(eq(tenants.id, tenantId));
    await client.sql.end({ timeout: 2 });
  });

  it('rejects a reused external conversation belonging to a different employee', async () => {
    if (!client || !service) return;
    const [tenant] = await client.db.insert(tenants).values({ name: `Ingestion owner ${randomUUID()}` }).returning();
    tenantIds.push(tenant!.id);
    const [owner, other] = await client.db.insert(users).values([
      { tenantId: tenant!.id }, { tenantId: tenant!.id },
    ]).returning();
    const externalConversationId = randomUUID();
    const owned = await service.findOrCreateConversation({
      tenantId: tenant!.id, userId: owner!.id, channelType: 'dev', externalConversationId,
    });
    const [beforeConflict] = await client.db.select({ updatedAt: conversations.updatedAt })
      .from(conversations).where(eq(conversations.id, owned.conversationId));

    await expect(service.findOrCreateConversation({
      tenantId: tenant!.id, userId: other!.id, channelType: 'dev', externalConversationId,
    })).rejects.toThrow('conversation_owner_mismatch');
    const [afterConflict] = await client.db.select({ updatedAt: conversations.updatedAt })
      .from(conversations).where(eq(conversations.id, owned.conversationId));
    expect(afterConflict?.updatedAt).toEqual(beforeConflict?.updatedAt);
    await expect(service.findOrCreateConversation({
      tenantId: tenant!.id, userId: owner!.id, channelType: 'dev', externalConversationId,
    })).resolves.toEqual(owned);
    const [stored] = await client.db.select({ userId: conversations.userId })
      .from(conversations).where(eq(conversations.id, owned.conversationId));
    expect(stored?.userId).toBe(owner!.id);

    await expect(service.saveInboundMessage({
      tenantId: tenant!.id, userId: other!.id, conversationId: owned.conversationId,
      text: 'Other employee private message.', externalMessageId: randomUUID(),
      occurredAt: new Date(), traceId: randomUUID(),
    })).rejects.toThrow('message_conversation_owner_mismatch');
    const saved = await service.saveInboundMessage({
      tenantId: tenant!.id, userId: owner!.id, conversationId: owned.conversationId,
      text: 'Owner private message.', externalMessageId: randomUUID(),
      occurredAt: new Date(), traceId: randomUUID(),
    });
    const [validMessage] = await client.db.select({ userId: messages.userId })
      .from(messages).where(eq(messages.id, saved.messageId));
    expect(validMessage?.userId).toBe(owner!.id);
    await expect(client.db.update(messages).set({ userId: other!.id })
      .where(eq(messages.id, saved.messageId)))
      .rejects.toThrow('message_conversation_owner_mismatch');
    const [stillOwned] = await client.db.select({ userId: messages.userId })
      .from(messages).where(eq(messages.id, saved.messageId));
    expect(stillOwned?.userId).toBe(owner!.id);
  });

  it('commits a Slack conversation admission with its inbound message', async () => {
    if (!client || !service) return;
    const [tenant] = await client.db.insert(tenants).values({ name: `Admission ${randomUUID()}` }).returning();
    tenantIds.push(tenant!.id);
    const [user] = await client.db.insert(users).values({ tenantId: tenant!.id }).returning();
    const externalConversationId = `D${randomUUID()}`;
    const { conversationId } = await service.findOrCreateConversation({
      tenantId: tenant!.id, userId: user!.id, channelType: 'slack', externalConversationId,
    });
    const externalMessageId = randomUUID();
    const input = {
      tenantId: tenant!.id, userId: user!.id, conversationId,
      text: 'Timely private reply.', externalMessageId, occurredAt: new Date(), traceId: randomUUID(),
    };
    const admission = {
      externalWorkspaceId: 'T1', externalConversationId,
      eventId: randomUUID(), requestId: randomUUID(),
    };
    await expect(service.saveInboundMessage(input, { ...admission, externalWorkspaceId: '' }))
      .rejects.toThrow();
    expect(await client.db.select({ id: messages.id }).from(messages)
      .where(eq(messages.externalMessageId, externalMessageId))).toHaveLength(0);

    const { messageId } = await service.saveInboundMessage(input, admission);
    const [pending] = await client.db.select().from(conversationJobAdmissions)
      .where(eq(conversationJobAdmissions.messageId, messageId));
    expect(pending).toMatchObject({
      tenantId: tenant!.id, userId: user!.id, conversationId,
      externalWorkspaceId: 'T1', externalConversationId, queuedAt: null,
    });
    await service.markConversationJobQueued({ messageId, tenantId: tenant!.id, userId: user!.id });
    const [queued] = await client.db.select({ queuedAt: conversationJobAdmissions.queuedAt })
      .from(conversationJobAdmissions).where(eq(conversationJobAdmissions.messageId, messageId));
    expect(queued?.queuedAt).toBeInstanceOf(Date);
  });
});
