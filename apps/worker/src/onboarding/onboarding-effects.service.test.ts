import { describe, expect, it, vi } from 'vitest';
import { OnboardingEffectsService } from './onboarding-effects.service';
import { stableId } from './stable-id';

function fakeDb(conversationRows: unknown[], accountRows: unknown[]) {
  const inserted: unknown[] = [];
  const select = vi.fn()
    .mockReturnValueOnce({ from: () => ({ where: () => ({ orderBy: () => ({ limit: async () => conversationRows }) }) }) })
    .mockReturnValueOnce({ from: () => ({ where: () => ({ limit: async () => accountRows }) }) });
  const insert = vi.fn(() => ({ values: (v: unknown) => { inserted.push(v); return { onConflictDoNothing: async () => undefined }; } }));
  return { db: { client: { select, insert } }, inserted };
}

const conv = [{ conversationId: 'c1', channelType: 'slack', externalConversationId: 'D1' }];
const acct = [{ externalWorkspaceId: 'W1' }];

function build(db: unknown) {
  const reminderQueue = { add: vi.fn().mockResolvedValue(undefined) };
  const conversationQueue = { add: vi.fn().mockResolvedValue(undefined) };
  const messageSendQueue = { add: vi.fn().mockResolvedValue(undefined) };
  const service = new OnboardingEffectsService(reminderQueue as never, conversationQueue as never, db as never, messageSendQueue as never);
  return { service, reminderQueue, conversationQueue, messageSendQueue };
}

describe('OnboardingEffectsService', () => {
  it('scheduleReminder uses a delayed deterministic job', async () => {
    const { service, reminderQueue } = build({});
    const dueAt = new Date(Date.now() + 60_000);
    await service.scheduleReminder({ tenantId: 't', personId: 'p', dueAt });
    const [name, data, opts] = reminderQueue.add.mock.calls[0]!;
    expect(name).toBe('remind');
    expect(data).toEqual({ tenantId: 't', personId: 'p', dueAt: dueAt.toISOString() });
    expect(opts.jobId).toBe(`onb-rem:p:${dueAt.getTime()}`);
    expect(opts.delay).toBeGreaterThan(0);
    expect(opts.delay).toBeLessThanOrEqual(60_000);
  });

  it('scheduleReminder clamps past due dates to zero delay', async () => {
    const { service, reminderQueue } = build({});
    await service.scheduleReminder({ tenantId: 't', personId: 'p', dueAt: new Date(Date.now() - 5_000) });
    expect(reminderQueue.add.mock.calls[0]![2].delay).toBe(0);
  });

  it('sendAcknowledgement persists with a stable id and enqueues message-send', async () => {
    const { db, inserted } = fakeDb(conv, acct);
    const { service, messageSendQueue } = build(db);
    await service.sendAcknowledgement({ tenantId: 't', personId: 'p', text: 'ok', dedupeKey: 'k' });
    const id = stableId('onb-ack', 'k');
    expect(inserted[0]).toMatchObject({ id, conversationId: 'c1', direction: 'outbound', messageType: 'onboarding_ack', text: 'ok' });
    expect(messageSendQueue.add).toHaveBeenCalledWith('send', expect.objectContaining({
      messageId: id, tenantId: 't', conversationId: 'c1', channelType: 'slack',
      externalWorkspaceId: 'W1', externalChannelId: 'D1', text: 'ok',
    }));
  });

  it('sendAcknowledgement skips without a conversation', async () => {
    const { db, inserted } = fakeDb([], []);
    const { service, messageSendQueue } = build(db);
    await service.sendAcknowledgement({ tenantId: 't', personId: 'p', text: 'ok', dedupeKey: 'k' });
    expect(inserted).toHaveLength(0);
    expect(messageSendQueue.add).not.toHaveBeenCalled();
  });

  it('startConversation enqueues a deduped check-in with onboardingStart', async () => {
    const { db } = fakeDb(conv, acct);
    const { service, conversationQueue } = build(db);
    await service.startConversation({ tenantId: 't', personId: 'p', dedupeKey: 'p:4' });
    const [name, data, opts] = conversationQueue.add.mock.calls[0]!;
    expect(name).toBe('check-in');
    expect(data).toMatchObject({ onboardingStart: true, userId: 'p', conversationId: 'c1', externalWorkspaceId: 'W1' });
    expect(opts).toEqual({ jobId: 'onb-start:p:4' });
  });
});
