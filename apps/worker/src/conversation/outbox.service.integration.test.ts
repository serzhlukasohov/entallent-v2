import { randomUUID } from 'node:crypto';
import { Queue } from 'bullmq';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OutboxService } from './outbox.service';

const redisUrl = process.env['REDIS_URL'];

describe.runIf(Boolean(redisUrl))('message-send queue identity on Redis', () => {
  let queue: Queue;

  beforeAll(() => {
    const redis = new URL(redisUrl!);
    queue = new Queue(`v2-outbox-${randomUUID()}`, { connection: {
      host: redis.hostname, port: Number(redis.port), db: Number(redis.pathname.slice(1) || 0),
      ...(redis.password ? { password: redis.password } : {}),
    } });
  });

  afterAll(async () => {
    if (!queue) return;
    await queue.obliterate({ force: true });
    await queue.close();
  });

  it('keeps one pending delivery for repeated enqueue of the same persisted message', async () => {
    const outbox = new OutboxService(
      queue as never, {} as never, {} as never, {} as never,
      {} as never, {} as never, {} as never,
    );
    const messageId = randomUUID();
    const payload = {
      messageId, tenantId: randomUUID(), conversationId: randomUUID(),
      channelType: 'dev', externalWorkspaceId: 'test', externalChannelId: 'test',
      text: 'private employee detail',
    };

    await outbox.enqueueMessageSend(payload);
    await outbox.enqueueMessageSend(payload);

    expect(await queue.getWaitingCount()).toBe(1);
    const job = await queue.getJob(`message-send-${messageId}`);
    expect(job?.data).toMatchObject({ messageId, tenantId: payload.tenantId });
    expect(JSON.stringify(job?.data)).not.toContain(payload.text);
  });

  it('uses one profile hydration job for repeated dispatch of an inbound turn', async () => {
    const outbox = new OutboxService(
      {} as never, {} as never, {} as never, {} as never,
      {} as never, {} as never, queue as never,
    );
    const inboundMessageId = randomUUID();
    const payload = {
      inboundMessageId, userId: randomUUID(), tenantId: randomUUID(),
      channelType: 'dev', externalWorkspaceId: 'test', traceId: 'synthetic',
    };

    await outbox.enqueueProfileHydration(payload);
    await outbox.enqueueProfileHydration(payload);

    const job = await queue.getJob(`profile-hydration-${inboundMessageId}`);
    expect(job?.data).toMatchObject(payload);
    expect(await queue.getJobs(['waiting'])).toHaveLength(2);
  });

  it('uses one delayed follow-up job per action and due time', async () => {
    const outbox = new OutboxService(
      {} as never, {} as never, queue as never, {} as never,
      {} as never, {} as never, {} as never,
    );
    const payload = {
      scheduledActionId: randomUUID(), tenantId: randomUUID(),
      userId: randomUUID(), traceId: 'synthetic',
      dueAt: new Date(Date.now() + 60_000),
    };

    await outbox.enqueueFollowUpExecution(payload);
    await outbox.enqueueFollowUpExecution(payload);

    expect(await queue.getJob(`follow-up-${payload.scheduledActionId}-${payload.dueAt.getTime()}`))
      .toBeDefined();
    expect(await queue.getJobs(['delayed'])).toHaveLength(1);
  });

  it('uses one group report job per confirmed group state', async () => {
    const outbox = new OutboxService(
      {} as never, {} as never, {} as never, {} as never,
      queue as never, {} as never, {} as never,
    );
    const sourceGroupStateId = randomUUID();
    const payload = {
      sourceGroupStateId, reportingCohortId: randomUUID(), tenantId: randomUUID(),
      teamId: randomUUID(), questionGroup: 'growth', traceId: 'synthetic',
    };

    await outbox.enqueueGroupReport(payload);
    await outbox.enqueueGroupReport(payload);

    expect(await queue.getJob(`group-report-${sourceGroupStateId}`)).toBeDefined();
    expect((await queue.getJobs(['waiting'])).filter((job) =>
      job.id?.startsWith('group-report-'))).toHaveLength(1);
  });
});
