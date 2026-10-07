import { randomUUID } from 'node:crypto';
import { Queue } from 'bullmq';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { introMessages } from '@entalent/application';
import { channelAccounts, createDbClient, messages, orgOnboardingDeliveries,
  orgUnits, people, tenants, users, type DbClient } from '@entalent/database';
import { QUEUE_NAMES } from '../queue/queue.module';
import { MessageSendProcessor, type MessageSendJob } from '../message-send/message-send.processor';
import { ConversationRepository } from './repositories/conversation.repository';
import { OnboardingDispatchService } from './onboarding-dispatch.service';
import { OnboardingIntroService } from '../onboarding/onboarding-intro.service';

const slack = vi.hoisted(() => ({ openDirectMessage: vi.fn(), sendMessage: vi.fn() }));
vi.mock('@entalent/channel-slack', () => ({
  SlackAdapter: class {
    openDirectMessage = slack.openDirectMessage;
    sendMessage = slack.sendMessage;
  },
}));

const databaseUrl = process.env['DATABASE_URL'];
const redisUrl = process.env['REDIS_URL'];
const localDatabase = databaseUrl && /^postgres(?:ql)?:\/\/(?:[^@]+@)?(?:127\.0\.0\.1|localhost):\d+\//.test(databaseUrl);
const localRedis = redisUrl && /^redis:\/\/(?:127\.0\.0\.1|localhost):\d+\/?$/.test(redisUrl);

describe.skipIf(!localDatabase || !localRedis)('onboarding through PostgreSQL and BullMQ', () => {
  const tenantId = randomUUID();
  const personId = randomUUID();
  const unitId = randomUUID();
  const deliveryId = randomUUID();
  const workspaceId = `T-${randomUUID()}`;
  const dmId = `D-${randomUUID()}`;
  let client: DbClient;
  let queue: Queue<MessageSendJob>;

  beforeAll(async () => {
    client = createDbClient(databaseUrl!);
    const url = new URL(redisUrl!);
    queue = new Queue<MessageSendJob>(QUEUE_NAMES.MESSAGE_SEND, {
      prefix: `hierarchy-acceptance-${randomUUID()}`,
      connection: { host: url.hostname, port: Number(url.port) },
    });
    await client.db.insert(tenants).values({ id: tenantId, name: 'Onboarding flow fixture' });
    await client.db.insert(users).values({ id: personId, tenantId, status: 'active' });
    await client.db.insert(people).values({ id: personId, tenantId,
      customerEmployeeId: 'L-1', workEmail: 'leader@fixture.test', displayName: 'Leader',
      primaryRole: 'leadership', pulseParticipant: false, lifecycleStatus: 'active' });
    await client.db.insert(orgUnits).values({ id: unitId, tenantId, customerUnitKey: 'U-1', name: 'Unit' });
    await client.db.insert(channelAccounts).values({ tenantId, userId: personId,
      channelType: 'slack', externalWorkspaceId: workspaceId, externalUserId: 'U-LEADER' });
    await client.db.insert(orgOnboardingDeliveries).values({ id: deliveryId, tenantId,
      personId, unitId, externalWorkspaceId: workspaceId });
    slack.openDirectMessage.mockResolvedValue(dmId);
    slack.sendMessage.mockResolvedValue({ externalMessageId: '123.456', sentAt: new Date(),
      externalThreadId: undefined });
  });

  afterAll(async () => {
    if (client) {
      await client.db.delete(tenants).where(eq(tenants.id, tenantId));
      await client.sql.end();
    }
    if (queue) {
      await queue.obliterate({ force: true });
      await queue.close();
    }
  });

  it('queues the approved two-message intro, chains the trust message after delivery, and records one Slack receipt across a retry', async () => {
    const repository = new ConversationRepository({ client: client.db } as never);
    const workspace = { findByExternalWorkspace: vi.fn().mockResolvedValue({ botToken: 'synthetic-token' }) };
    const intro = new OnboardingIntroService({ client: client.db } as never, queue as never);
    const dispatcher = new OnboardingDispatchService({ client: client.db } as never, workspace as never, intro);

    expect(await dispatcher.dispatchPending(tenantId, randomUUID())).toEqual({ found: 0, queued: 0, failed: 0 });
    expect(slack.openDirectMessage).not.toHaveBeenCalled();
    expect(await dispatcher.dispatchPending(tenantId)).toEqual({ found: 1, queued: 1, failed: 0 });
    expect(slack.openDirectMessage).toHaveBeenCalledWith('U-LEADER');

    // Only the first half is queued; the trust half is persisted and waits.
    const queued = await queue.getWaiting();
    expect(queued).toHaveLength(1);
    expect(queued[0]!.data).toMatchObject({ messageId: deliveryId, tenantId,
      externalWorkspaceId: workspaceId, externalChannelId: dmId });
    const copy = introMessages('leadership');
    const [first] = await client.db.select().from(messages).where(eq(messages.id, deliveryId));
    expect(first?.text).toBe(copy.intro);
    expect(first?.messageType).toBe('onboarding_intro');
    const trustId = (first?.metadata as { onboardingTrustMessageId: string }).onboardingTrustMessageId;
    const [trust] = await client.db.select().from(messages).where(eq(messages.id, trustId));
    expect(trust?.text).toBe(copy.trust);
    expect(trust?.sentAt).toBeNull();

    const onboarding = { recordIntroDelivered: vi.fn() };
    const sender = new MessageSendProcessor(workspace as never, repository,
      { activateDeliveredConfirmation: vi.fn() } as never, onboarding as never, intro);
    await sender.process(queued[0]!);
    await sender.process(queued[0]!);
    expect(slack.sendMessage).toHaveBeenCalledTimes(1);
    expect(slack.sendMessage.mock.calls[0]![0]).not.toHaveProperty('actions');
    expect(onboarding.recordIntroDelivered).not.toHaveBeenCalled();
    const [intent] = await client.db.select().from(orgOnboardingDeliveries)
      .where(eq(orgOnboardingDeliveries.id, deliveryId));
    expect(intent).toMatchObject({ status: 'delivered', attemptCount: 1, externalMessageId: '123.456' });

    // Delivering the first half released exactly one trust job, with the buttons.
    const afterIntro = await queue.getWaiting();
    const trustJobs = afterIntro.filter((j) => j.data.messageId === trustId);
    expect(trustJobs).toHaveLength(1);
    await sender.process(trustJobs[0]!);
    expect(slack.sendMessage).toHaveBeenCalledTimes(2);
    expect(slack.sendMessage.mock.calls[1]![0]).toMatchObject({ text: copy.trust,
      actions: [{ actionId: 'onboarding:got_it', label: 'Got It', value: 'got_it' }] });
    expect(onboarding.recordIntroDelivered).toHaveBeenCalledOnce();
    expect(await dispatcher.dispatchPending(tenantId)).toEqual({ found: 0, queued: 0, failed: 0 });
    expect(await client.db.select().from(messages).where(eq(messages.userId, personId))).toHaveLength(2);
  });
});
