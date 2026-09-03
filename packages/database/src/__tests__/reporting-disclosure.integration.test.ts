import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  conversations,
  messages,
  surveyDefinitions,
  surveyGroupStates,
  surveyWindows,
  tenants,
  users,
} from '../schema';
import { closeTestDb, describeIntegration, getTestDb, runMigrationsOnce } from './integration-setup';

describeIntegration('Reporting disclosure proof (integration)', () => {
  let tenantId: string;
  let userId: string;
  let windowId: string;
  let conversationId: string;
  let confirmationMessageId: string;
  let confirmationPromptMessageId: string;
  const confirmationSummary = 'The exact summary shown to the employee.';
  const shownAt = new Date('2026-09-03T09:00:00.000Z');
  const confirmedAt = new Date('2026-09-03T10:00:00.000Z');

  beforeAll(async () => {
    await runMigrationsOnce();
    const { db } = getTestDb();
    const suffix = randomUUID();
    const [tenant] = await db.insert(tenants).values({ name: `Disclosure ${suffix}` }).returning();
    tenantId = tenant!.id;
    const [user] = await db.insert(users).values({ tenantId }).returning();
    userId = user!.id;
    const [conversation] = await db.insert(conversations).values({
      tenantId,
      userId,
      channelType: 'slack',
      externalConversationId: `disclosure-${suffix}`,
    }).returning();
    conversationId = conversation!.id;
    const [confirmation] = await db.insert(messages).values({
      tenantId,
      userId,
      conversationId: conversation!.id,
      direction: 'inbound',
      senderType: 'user',
      text: 'yes',
      occurredAt: confirmedAt,
    }).returning();
    confirmationMessageId = confirmation!.id;
    const [prompt] = await db.insert(messages).values({
      tenantId,
      userId,
      conversationId: conversation!.id,
      direction: 'outbound',
      senderType: 'agent',
      text: `${confirmationSummary} Did I get that right?`,
      metadata: { confirmationSummary },
      occurredAt: shownAt,
      sentAt: shownAt,
    }).returning();
    confirmationPromptMessageId = prompt!.id;
    const [definition] = await db.insert(surveyDefinitions).values({
      tenantId,
      name: `Disclosure ${suffix}`,
      version: '1',
    }).returning();
    const [window] = await db.insert(surveyWindows).values({
      tenantId,
      userId,
      surveyDefinitionId: definition!.id,
      periodStart: new Date('2026-07-01T00:00:00.000Z'),
      periodEnd: new Date('2026-09-30T23:59:59.999Z'),
    }).returning();
    windowId = window!.id;
  });

  afterAll(async () => {
    const { db } = getTestDb();
    if (tenantId) await db.delete(tenants).where(eq(tenants.id, tenantId));
    await closeTestDb();
  });

  it('rejects confirmation when disclosure and confirmation timestamps are equal', async () => {
    const { db } = getTestDb();
    await expect(db.insert(surveyGroupStates).values({
      surveyWindowId: windowId,
      userId,
      tenantId,
      questionGroup: 'autonomy',
      status: 'confirmed',
      aiSummary: confirmationSummary,
      confirmedAt,
      reportingDisclosureVersion: 'reporting-disclosure-v1',
      reportingDisclosureShownAt: confirmedAt,
      confirmationMessageId,
      confirmationPromptMessageId,
    })).rejects.toThrow();
  });

  it('accepts confirmation backed by an earlier disclosure', async () => {
    const { db } = getTestDb();
    const [row] = await db.insert(surveyGroupStates).values({
      surveyWindowId: windowId,
      userId,
      tenantId,
      questionGroup: 'growth',
      status: 'confirmed',
      aiSummary: confirmationSummary,
      confirmedAt,
      reportingDisclosureVersion: 'reporting-disclosure-v1',
      reportingDisclosureShownAt: shownAt,
      confirmationMessageId,
      confirmationPromptMessageId,
    }).returning();
    expect(row?.status).toBe('confirmed');
  });

  it('allows at most one staged or awaiting confirmation per tenant user', async () => {
    const { db } = getTestDb();
    const prompts = await db.insert(messages).values([
      {
        tenantId,
        userId,
        conversationId,
        direction: 'outbound',
        senderType: 'agent',
        text: 'First summary. Right?',
        metadata: { confirmationSummary: 'First summary.' },
        occurredAt: shownAt,
        sentAt: shownAt,
      },
      {
        tenantId,
        userId,
        conversationId,
        direction: 'outbound',
        senderType: 'agent',
        text: 'Second summary. Right?',
        metadata: { confirmationSummary: 'Second summary.' },
        occurredAt: shownAt,
        sentAt: shownAt,
      },
    ]).returning();

    const states = await db.insert(surveyGroupStates).values([
      {
        surveyWindowId: windowId,
        userId,
        tenantId,
        questionGroup: 'belonging',
        status: 'pending_confirmation',
      },
      {
        surveyWindowId: windowId,
        userId,
        tenantId,
        questionGroup: 'purpose',
        status: 'pending_confirmation',
      },
    ]).returning();

    await db.update(surveyGroupStates)
      .set({ confirmationPromptMessageId: prompts[0]!.id })
      .where(eq(surveyGroupStates.id, states[0]!.id));
    await expect(db.update(surveyGroupStates)
      .set({ confirmationPromptMessageId: prompts[1]!.id })
      .where(eq(surveyGroupStates.id, states[1]!.id))).rejects.toThrow();
  });
});
