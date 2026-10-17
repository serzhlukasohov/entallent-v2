import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { conversationActivityDaily, conversations, messages, tenants, users } from '../schema';
import { closeTestDb, describeIntegration, getTestDb, runMigrationsOnce } from './integration-setup';

describeIntegration('content-free conversation activity projection (integration)', () => {
  let tenantId: string;

  beforeAll(async () => runMigrationsOnce());
  afterAll(async () => {
    const { db } = getTestDb();
    if (tenantId) await db.delete(tenants).where(eq(tenants.id, tenantId));
    await closeTestDb();
  });

  it('tracks inserts, edits, soft deletion, hard deletion, and employee deletion without text', async () => {
    const { db } = getTestDb();
    const [tenant] = await db.insert(tenants).values({ name: `Activity ${randomUUID()}` }).returning();
    tenantId = tenant!.id;
    const [user] = await db.insert(users).values({ tenantId }).returning();
    const [conversation] = await db.insert(conversations).values({
      tenantId, userId: user!.id, channelType: 'slack', externalConversationId: randomUUID(),
    }).returning();
    const base = { tenantId, userId: user!.id, conversationId: conversation!.id };
    const firstDay = new Date('2026-09-20T09:00:00Z');
    const secondDay = new Date('2026-09-21T09:00:00Z');
    const [inbound, init, outbound] = await db.insert(messages).values([
      { ...base, direction: 'inbound', senderType: 'user', text: 'Private text', occurredAt: firstDay },
      { ...base, direction: 'inbound', senderType: 'user', text: '__init__', occurredAt: firstDay },
      { ...base, direction: 'outbound', senderType: 'agent', text: 'Private reply', occurredAt: firstDay },
    ]).returning();
    const rows = () => db.select().from(conversationActivityDaily).where(and(
      eq(conversationActivityDaily.tenantId, tenantId),
      eq(conversationActivityDaily.userId, user!.id),
    )).orderBy(conversationActivityDaily.day);
    expect(await rows()).toMatchObject([{ day: '2026-09-20', inboundCount: 2,
      outboundCount: 1, inboundNonInitCount: 1 }]);
    expect(Object.keys((await rows())[0]!)).not.toContain('text');

    await db.update(messages).set({ text: 'Now substantive' }).where(eq(messages.id, init!.id));
    await db.update(messages).set({ deletedAt: new Date() }).where(eq(messages.id, inbound!.id));
    await db.update(messages).set({ occurredAt: secondDay }).where(eq(messages.id, outbound!.id));
    expect(await rows()).toMatchObject([
      { day: '2026-09-20', inboundCount: 1, outboundCount: 0, inboundNonInitCount: 1 },
      { day: '2026-09-21', inboundCount: 0, outboundCount: 1, inboundNonInitCount: 0 },
    ]);

    await db.delete(messages).where(eq(messages.id, outbound!.id));
    expect(await rows()).toMatchObject([
      { day: '2026-09-20', inboundCount: 1, outboundCount: 0 },
      { day: '2026-09-21', inboundCount: 0, outboundCount: 0 },
    ]);
    await db.delete(users).where(eq(users.id, user!.id));
    expect(await rows()).toHaveLength(0);
  });
});
