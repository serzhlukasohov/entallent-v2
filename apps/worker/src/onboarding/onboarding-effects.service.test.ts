import { describe, expect, it, vi } from 'vitest';

const slack = vi.hoisted(() => ({ updateMessage: vi.fn() }));
vi.mock('@entalent/channel-slack', () => ({
  SlackAdapter: class { updateMessage = slack.updateMessage; },
}));

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

function build(db: unknown, workspaceRepo: unknown = {}) {
  const reminderQueue = { add: vi.fn().mockResolvedValue(undefined) };
  const conversationQueue = { add: vi.fn().mockResolvedValue(undefined) };
  const messageSendQueue = { add: vi.fn().mockResolvedValue(undefined) };
  const intro = { sendIntro: vi.fn().mockResolvedValue({ introMessageId: 'i', trustMessageId: 't' }) };
  const service = new OnboardingEffectsService(reminderQueue as never, conversationQueue as never, db as never, messageSendQueue as never, workspaceRepo as never, intro as never);
  return { service, reminderQueue, conversationQueue, messageSendQueue, intro };
}

describe('OnboardingEffectsService', () => {
  it('sendRoleIntro delegates to the intro service with the delivery target, role and version', async () => {
    const { db } = fakeDb(conv, acct);
    const { service, intro } = build(db);
    await service.sendRoleIntro({ tenantId: 't', personId: 'p', role: 'team_lead', version: 7 });
    expect(intro.sendIntro).toHaveBeenCalledWith({
      tenantId: 't', personId: 'p', role: 'team_lead', version: 7, roleChange: true,
      conversation: { id: 'c1', channelType: 'slack', externalConversationId: 'D1', externalWorkspaceId: 'W1' },
    });
  });

  it('sendRoleIntro sends nothing when the person has no active conversation', async () => {
    const { db } = fakeDb([], []);
    const { service, intro } = build(db);
    await service.sendRoleIntro({ tenantId: 't', personId: 'p', role: 'employee', version: 2 });
    expect(intro.sendIntro).not.toHaveBeenCalled();
  });

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
    expect(data).toMatchObject({ onboardingStart: true, onboardingStartKey: expect.any(String), userId: 'p', conversationId: 'c1', externalWorkspaceId: 'W1' });
    expect(opts).toEqual({ jobId: 'onb-start:p:4' });
  });

  describe('replaceIntroActions', () => {
    const input = { tenantId: 't', personId: 'p', channelId: 'D1', messageTs: '10.5', text: 'Body\n\n_Done_' };

    it('updates the intro message without buttons using the tenant bot token', async () => {
      slack.updateMessage.mockReset().mockResolvedValue(undefined);
      const repo = {
        findSlackAccountByUserId: vi.fn().mockResolvedValue({ externalWorkspaceId: 'W1', externalUserId: 'U1' }),
        findByExternalWorkspace: vi.fn().mockResolvedValue({ botToken: 'xoxb' }),
      };
      await expect(build({}, repo).service.replaceIntroActions(input)).resolves.toBe(true);
      expect(repo.findByExternalWorkspace).toHaveBeenCalledWith('slack', 'W1', 't');
      expect(slack.updateMessage).toHaveBeenCalledWith({
        tenantId: 't', externalChannelId: 'D1', externalMessageId: '10.5', text: 'Body\n\n_Done_',
      });
    });

    it('logs and does not throw when Slack fails', async () => {
      slack.updateMessage.mockReset().mockRejectedValue(new Error('boom'));
      const repo = {
        findSlackAccountByUserId: vi.fn().mockResolvedValue({ externalWorkspaceId: 'W1', externalUserId: 'U1' }),
        findByExternalWorkspace: vi.fn().mockResolvedValue({ botToken: 'xoxb' }),
      };
      await expect(build({}, repo).service.replaceIntroActions(input)).resolves.toBe(false);
    });

    it('does nothing when no workspace connection exists', async () => {
      slack.updateMessage.mockReset();
      const repo = { findSlackAccountByUserId: vi.fn().mockResolvedValue(null), findByExternalWorkspace: vi.fn() };
      await expect(build({}, repo).service.replaceIntroActions(input)).resolves.toBe(false);
      expect(slack.updateMessage).not.toHaveBeenCalled();
    });
  });
});
