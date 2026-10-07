import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { introMessages } from '@entalent/application';
import { conversations, createDbClient, messages, onboardingStates, people, tenants, users, type DbClient } from '@entalent/database';
import { OnboardingIntroService } from './onboarding-intro.service';
import { stableId } from './stable-id';

const databaseUrl = process.env['DATABASE_URL'];
const localDatabase = databaseUrl && /^postgres(?:ql)?:\/\/(?:[^@]+@)?(?:127\.0\.0\.1|localhost):\d+\//.test(databaseUrl);

describe.skipIf(!localDatabase)('OnboardingIntroService against PostgreSQL', () => {
  const tenantId = randomUUID();
  const conversationId = randomUUID();
  let client: DbClient;
  const queue = { add: vi.fn().mockResolvedValue(undefined) };
  let service: OnboardingIntroService;
  const convo = (externalConversationId = 'D1') => ({
    id: conversationId, channelType: 'slack', externalConversationId, externalWorkspaceId: 'W1',
  });

  async function newPerson(role: 'employee' | 'manager'): Promise<string> {
    const id = randomUUID();
    await client.db.insert(users).values({ id, tenantId, status: 'active' });
    await client.db.insert(people).values({ id, tenantId, customerEmployeeId: id.slice(0, 8),
      workEmail: `${id}@fixture.test`, displayName: 'P', primaryRole: role,
      pulseParticipant: role === 'employee', lifecycleStatus: 'active' });
    return id;
  }

  beforeAll(async () => {
    client = createDbClient(databaseUrl!);
    await client.db.insert(tenants).values({ id: tenantId, name: 'Intro service fixture' });
    service = new OnboardingIntroService({ client: client.db } as never, queue as never);
  });

  afterAll(async () => {
    if (client) {
      await client.db.delete(tenants).where(eq(tenants.id, tenantId));
      await client.sql.end();
    }
  });

  async function useConversation(personId: string) {
    await client.db.insert(conversations).values({ id: conversationId, tenantId, userId: personId,
      channelType: 'slack', externalConversationId: 'D1' }).onConflictDoNothing();
  }

  it('persists two approved messages (buttons only on the second), enqueues only the first, and is idempotent', async () => {
    const personId = await newPerson('employee');
    await useConversation(personId);
    const deliveryId = randomUUID();
    queue.add.mockClear();

    const first = await service.sendIntro({ tenantId, personId, role: 'employee', deliveryId, conversation: convo() });
    const second = await service.sendIntro({ tenantId, personId, role: 'employee', deliveryId, conversation: convo() });

    expect(second).toEqual(first);
    expect(first.introMessageId).toBe(deliveryId);
    expect(first.trustMessageId).toBe(stableId('onb-intro', personId, '0', 'trust'));
    const rows = await client.db.select().from(messages).where(and(eq(messages.tenantId, tenantId), eq(messages.userId, personId)));
    expect(rows).toHaveLength(2);
    const copy = introMessages('employee');
    const intro = rows.find((r) => r.id === first.introMessageId)!;
    const trust = rows.find((r) => r.id === first.trustMessageId)!;
    expect(intro.text).toBe(copy.intro);
    expect(trust.text).toBe(copy.trust);
    expect(intro.messageType).toBe('onboarding_intro');
    expect(trust.messageType).toBe('onboarding_intro');
    expect(intro.metadata).toEqual({ onboardingDeliveryId: deliveryId, onboardingIntroPart: 'intro',
      onboardingTrustMessageId: first.trustMessageId });
    expect(trust.metadata).toEqual({ onboardingIntroPart: 'trust', onboardingActions: [
      { actionId: 'onboarding:start', label: "Let's Talk", value: 'start' },
      { actionId: 'onboarding:later', label: 'Later', value: 'later' },
      { actionId: 'onboarding:decline', label: "I Don't Want to Participate", value: 'decline' },
    ] });
    expect(queue.add.mock.calls.map((c) => (c[1] as { messageId: string }).messageId)).toEqual([deliveryId, deliveryId]);
    const [state] = await client.db.select().from(onboardingStates).where(eq(onboardingStates.personId, personId));
    expect(state).toMatchObject({ track: 'employee', introStatus: 'pending', participation: 'undecided', version: 0 });
  });

  it('reuses the stored trust message when a retry sees a newer state version', async () => {
    const personId = await newPerson('employee');
    await useConversation(personId);
    const deliveryId = randomUUID();
    const first = await service.sendIntro({ tenantId, personId, role: 'employee', deliveryId, conversation: convo() });
    await client.db.update(onboardingStates).set({ version: 5 }).where(eq(onboardingStates.personId, personId));
    const retry = await service.sendIntro({ tenantId, personId, role: 'employee', deliveryId, conversation: convo() });
    expect(retry.trustMessageId).toBe(first.trustMessageId);
    const rows = await client.db.select().from(messages).where(eq(messages.userId, personId));
    expect(rows).toHaveLength(2);
  });

  it('role-change intros without a delivery row key both ids by the supplied version', async () => {
    const personId = await newPerson('manager');
    await useConversation(personId);
    const r = await service.sendIntro({ tenantId, personId, role: 'manager', version: 3, conversation: convo() });
    expect(r).toEqual({
      introMessageId: stableId('onb-intro', personId, '3', 'intro'),
      trustMessageId: stableId('onb-intro', personId, '3', 'trust'),
    });
    const [trust] = await client.db.select().from(messages).where(eq(messages.id, r.trustMessageId));
    expect(trust!.metadata).toMatchObject({ onboardingActions: [{ actionId: 'onboarding:got_it', label: 'Got It', value: 'got_it' }] });
  });

  it('enqueues the trust message once after the intro, and not when it was already sent', async () => {
    const personId = await newPerson('employee');
    await useConversation(personId);
    const r = await service.sendIntro({ tenantId, personId, role: 'employee', deliveryId: randomUUID(), conversation: convo() });
    queue.add.mockClear();
    const input = { tenantId, conversationId, channelType: 'slack', externalWorkspaceId: 'W1', externalChannelId: 'D1',
      introMetadata: { onboardingIntroPart: 'intro', onboardingTrustMessageId: r.trustMessageId } };

    await service.enqueueTrustAfterIntro(input);
    expect(queue.add).toHaveBeenCalledWith('send', expect.objectContaining({
      messageId: r.trustMessageId, text: introMessages('employee').trust,
    }), { jobId: `onb-trust-${r.trustMessageId}` });

    queue.add.mockClear();
    await client.db.update(messages).set({ sentAt: new Date() }).where(eq(messages.id, r.trustMessageId));
    await service.enqueueTrustAfterIntro(input);
    await service.enqueueTrustAfterIntro({ ...input, introMetadata: { onboardingIntroPart: 'trust' } });
    expect(queue.add).not.toHaveBeenCalled();
  });
});
