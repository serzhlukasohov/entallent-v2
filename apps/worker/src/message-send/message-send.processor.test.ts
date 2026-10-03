import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { MessageSendProcessor, type MessageSendJob } from './message-send.processor';

const slack = vi.hoisted(() => ({ sendMessage: vi.fn() }));

vi.mock('@entalent/channel-slack', () => ({
  SlackAdapter: class {
    sendMessage = slack.sendMessage;
  },
}));

beforeEach(() => {
  slack.sendMessage.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('MessageSendProcessor', () => {
  it('marks a dev response delivered without logging its text', async () => {
    const log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const sentAt = new Date('2026-09-03T10:00:00.000Z');
    vi.useFakeTimers();
    vi.setSystemTime(sentAt);
    const updateMessageDelivery = vi.fn().mockResolvedValue(sentAt);
    const findOutboundMessageForDelivery = vi.fn().mockResolvedValue({
      userId: 'user-1',
      text: 'persisted response',
      sentAt: null,
      channelType: 'dev',
      externalConversationId: 'channel-1',
    });
    const activateDeliveredConfirmation = vi.fn().mockResolvedValue(false);
    const activateDeliveredQuestionBundle = vi.fn().mockResolvedValue(undefined);
    const processor = new MessageSendProcessor(
      {} as never,
      { updateMessageDelivery, findOutboundMessageForDelivery, findOnboardingDelivery: vi.fn().mockResolvedValue(null), isUserRuntimeEligible: vi.fn().mockResolvedValue(true) } as never,
      { activateDeliveredConfirmation } as never,
      { activateDeliveredQuestionBundle } as never,
    );
    const data: MessageSendJob = {
      messageId: 'message-1',
      tenantId: 'tenant-1',
      conversationId: 'conversation-1',
      channelType: 'dev',
      externalWorkspaceId: 'workspace-1',
      externalChannelId: 'channel-1',
    };

    await processor.process({ data } as Job<MessageSendJob>);

    expect(JSON.stringify(log.mock.calls)).not.toContain('persisted response');

    expect(updateMessageDelivery).toHaveBeenCalledWith('message-1', {
      tenantId: 'tenant-1',
      conversationId: 'conversation-1',
      externalMessageId: 'dev:message-1',
      sentAt,
    });
    expect(activateDeliveredConfirmation).toHaveBeenCalledWith({
      confirmationPromptMessageId: 'message-1',
      tenantId: 'tenant-1',
      conversationId: 'conversation-1',
      deliveredAt: sentAt,
    });
    expect(activateDeliveredQuestionBundle).toHaveBeenCalledWith({
      promptMessageId: 'message-1',
      tenantId: 'tenant-1',
      conversationId: 'conversation-1',
      deliveredAt: sentAt,
    });
  });

  it('records provider delivery time only after Slack succeeds', async () => {
    const sentAt = new Date('2026-09-03T10:00:00.000Z');
    slack.sendMessage.mockResolvedValue({
      externalMessageId: '1725367200.000001',
      externalThreadId: '1725367200.000001',
      sentAt,
    });
    const updateMessageDelivery = vi.fn().mockResolvedValue(sentAt);
    const findOutboundMessageForDelivery = vi.fn().mockResolvedValue({
      userId: 'user-1',
      text: 'persisted exact response',
      sentAt: null,
      channelType: 'slack',
      externalConversationId: 'channel-1',
    });
    const activateDeliveredConfirmation = vi.fn().mockResolvedValue(true);
    const findByExternalWorkspace = vi.fn().mockResolvedValue({ botToken: 'test-token' });
    const processor = new MessageSendProcessor(
      { findByExternalWorkspace } as never,
      { updateMessageDelivery, findOutboundMessageForDelivery, findOnboardingDelivery: vi.fn().mockResolvedValue(null), isUserRuntimeEligible: vi.fn().mockResolvedValue(true) } as never,
      { activateDeliveredConfirmation } as never,
    );

    await processor.process({ data: slackJob() } as Job<MessageSendJob>);

    expect(updateMessageDelivery).toHaveBeenCalledWith('message-1', {
      tenantId: 'tenant-1',
      conversationId: 'conversation-1',
      externalMessageId: '1725367200.000001',
      externalThreadId: '1725367200.000001',
      sentAt,
    });
    expect(slack.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'persisted exact response' }),
    );
    expect(findByExternalWorkspace).toHaveBeenCalledWith('slack', 'workspace-1', 'tenant-1');
    expect(activateDeliveredConfirmation).toHaveBeenCalledWith({
      confirmationPromptMessageId: 'message-1',
      tenantId: 'tenant-1',
      conversationId: 'conversation-1',
      deliveredAt: sentAt,
    });
  });

  it('does not create a disclosure receipt when Slack delivery fails', async () => {
    slack.sendMessage.mockRejectedValue(new Error('slack unavailable: private employee detail'));
    const updateMessageDelivery = vi.fn().mockResolvedValue(undefined);
    const findOutboundMessageForDelivery = vi.fn().mockResolvedValue({
      userId: 'user-1',
      text: 'persisted response',
      sentAt: null,
      channelType: 'slack',
      externalConversationId: 'channel-1',
    });
    const activateDeliveredConfirmation = vi.fn();
    const processor = new MessageSendProcessor(
      { findByExternalWorkspace: vi.fn().mockResolvedValue({ botToken: 'test-token' }) } as never,
      { updateMessageDelivery, findOutboundMessageForDelivery, findOnboardingDelivery: vi.fn().mockResolvedValue(null), isUserRuntimeEligible: vi.fn().mockResolvedValue(true) } as never,
      { activateDeliveredConfirmation } as never,
    );

    await expect(
      processor.process({ data: slackJob() } as Job<MessageSendJob>),
    ).rejects.toThrow('outbound_delivery_failed');
    expect(updateMessageDelivery).not.toHaveBeenCalled();
    expect(activateDeliveredConfirmation).not.toHaveBeenCalled();
  });

  it('does not repeat an uncertain committed Slack send', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    slack.sendMessage.mockRejectedValue(new Error('provider result unknown: private detail'));
    const claimCommittedMessageSendAttempt = vi.fn()
      .mockResolvedValueOnce('claimed').mockResolvedValueOnce('already_started');
    const updateMessageDelivery = vi.fn();
    const processor = new MessageSendProcessor(
      { findByExternalWorkspace: vi.fn().mockResolvedValue({ botToken: 'test-token' }) } as never,
      {
        findOutboundMessageForDelivery: vi.fn().mockResolvedValue({
          userId: 'user-1', text: 'private detail', sentAt: null,
          channelType: 'slack', externalConversationId: 'channel-1',
        }),
        findOnboardingDelivery: vi.fn().mockResolvedValue(null),
        isUserRuntimeEligible: vi.fn().mockResolvedValue(true),
        claimCommittedMessageSendAttempt,
        updateMessageDelivery,
      } as never,
      { activateDeliveredConfirmation: vi.fn() } as never,
    );

    await expect(processor.process({ data: slackJob() } as Job<MessageSendJob>))
      .rejects.toThrow('outbound_delivery_failed');
    await processor.process({ data: slackJob() } as Job<MessageSendJob>);

    expect(slack.sendMessage).toHaveBeenCalledOnce();
    expect(updateMessageDelivery).not.toHaveBeenCalled();
    expect(JSON.stringify(warn.mock.calls)).not.toContain('private detail');
  });

  it('does not send a queued Slack message after the Person becomes ineligible', async () => {
    const findByExternalWorkspace = vi.fn();
    const updateMessageDelivery = vi.fn();
    const activateDeliveredConfirmation = vi.fn();
    const processor = new MessageSendProcessor(
      { findByExternalWorkspace } as never,
      {
        findOutboundMessageForDelivery: vi.fn().mockResolvedValue({
          userId: 'inactive-person',
          text: 'queued response',
          sentAt: null,
          channelType: 'slack',
          externalConversationId: 'channel-1',
        }),
        isUserRuntimeEligible: vi.fn().mockResolvedValue(false),
        findOnboardingDelivery: vi.fn().mockResolvedValue(null),
        updateMessageDelivery,
      } as never,
      { activateDeliveredConfirmation } as never,
    );

    await processor.process({ data: slackJob() } as Job<MessageSendJob>);

    expect(findByExternalWorkspace).not.toHaveBeenCalled();
    expect(slack.sendMessage).not.toHaveBeenCalled();
    expect(updateMessageDelivery).not.toHaveBeenCalled();
    expect(activateDeliveredConfirmation).not.toHaveBeenCalled();
  });

  it('retries activation without sending again after delivery was already persisted', async () => {
    const deliveredAt = new Date('2026-09-03T10:00:00.000Z');
    slack.sendMessage.mockResolvedValue({
      externalMessageId: 'duplicate',
      sentAt: new Date('2026-09-03T10:01:00.000Z'),
    });
    const updateMessageDelivery = vi.fn();
    const activateDeliveredConfirmation = vi.fn().mockResolvedValue(true);
    const processor = new MessageSendProcessor(
      { findByExternalWorkspace: vi.fn() } as never,
      {
        findOutboundMessageForDelivery: vi.fn().mockResolvedValue({
          userId: 'user-1',
          text: 'persisted exact response',
          sentAt: deliveredAt,
          channelType: 'slack',
          externalConversationId: 'channel-1',
        }),
        updateMessageDelivery,
        isUserRuntimeEligible: vi.fn().mockResolvedValue(true),
        findOnboardingDelivery: vi.fn().mockResolvedValue(null),
      } as never,
      { activateDeliveredConfirmation } as never,
    );

    await processor.process({ data: slackJob() } as Job<MessageSendJob>);

    expect(slack.sendMessage).not.toHaveBeenCalled();
    expect(updateMessageDelivery).not.toHaveBeenCalled();
    expect(activateDeliveredConfirmation).toHaveBeenCalledWith({
      confirmationPromptMessageId: 'message-1',
      tenantId: 'tenant-1',
      conversationId: 'conversation-1',
      deliveredAt,
    });
  });

  it.each([false, true])('keeps private repository errors out of the failed reason (already sent: %s)',
    async (alreadySent) => {
      const privateMarker = 'private employee Bundle statement';
      const sentAt = new Date('2026-09-03T10:00:00.000Z');
      const updateMessageDelivery = vi.fn().mockResolvedValue(sentAt);
      const processor = new MessageSendProcessor(
        {} as never,
        {
          findOutboundMessageForDelivery: vi.fn().mockResolvedValue({
            userId: 'user-1', text: privateMarker,
            sentAt: alreadySent ? sentAt : null,
            channelType: 'dev', externalConversationId: 'channel-1',
          }),
          findOnboardingDelivery: vi.fn().mockResolvedValue(null),
          isUserRuntimeEligible: vi.fn().mockResolvedValue(true),
          updateMessageDelivery,
        } as never,
        { activateDeliveredConfirmation: vi.fn().mockResolvedValue(false) } as never,
        { activateDeliveredQuestionBundle: vi.fn().mockRejectedValue(new Error(privateMarker)) } as never,
      );
      const data = { ...slackJob(), channelType: 'dev' };

      const failure = await processor.process({ data } as Job<MessageSendJob>).catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(Error);
      expect((failure as Error).message).toBe('outbound_delivery_state_unknown');
      expect((failure as Error).stack).not.toContain(privateMarker);
      expect(updateMessageDelivery).toHaveBeenCalledTimes(alreadySent ? 0 : 1);
    });

  it('redacts a delivery-record failure before BullMQ can persist it', async () => {
    const privateMarker = 'private outbound message';
    const processor = new MessageSendProcessor(
      {} as never,
      {
        findOutboundMessageForDelivery: vi.fn().mockResolvedValue({
          userId: 'user-1', text: privateMarker, sentAt: null,
          channelType: 'dev', externalConversationId: 'channel-1',
        }),
        findOnboardingDelivery: vi.fn().mockResolvedValue(null),
        isUserRuntimeEligible: vi.fn().mockResolvedValue(true),
        updateMessageDelivery: vi.fn().mockRejectedValue(new Error(privateMarker)),
      } as never,
      { activateDeliveredConfirmation: vi.fn() } as never,
    );

    const data = { ...slackJob(), channelType: 'dev' };
    const failure = await processor.process({ data } as Job<MessageSendJob>)
      .catch((error: unknown) => error);
    expect((failure as Error).message).toBe('outbound_delivery_state_unknown');
    expect((failure as Error).stack).not.toContain(privateMarker);
  });

  it.each([
    ['channel type', { channelType: 'dev' }],
    ['external channel', { externalChannelId: 'channel-2' }],
  ])('rejects a queued %s that differs from the persisted conversation route', async (_label, patch) => {
    slack.sendMessage.mockResolvedValue({
      externalMessageId: 'should-not-send',
      sentAt: new Date('2026-09-03T10:00:00.000Z'),
    });
    const findByExternalWorkspace = vi.fn().mockResolvedValue({ botToken: 'test-token' });
    const updateMessageDelivery = vi.fn();
    const activateDeliveredConfirmation = vi.fn();
    const processor = new MessageSendProcessor(
      { findByExternalWorkspace } as never,
      {
        findOutboundMessageForDelivery: vi.fn().mockResolvedValue({
          userId: 'user-1',
          text: 'persisted exact response',
          sentAt: null,
          channelType: 'slack',
          externalConversationId: 'channel-1',
        }),
        updateMessageDelivery,
        isUserRuntimeEligible: vi.fn().mockResolvedValue(true),
        findOnboardingDelivery: vi.fn().mockResolvedValue(null),
      } as never,
      { activateDeliveredConfirmation } as never,
    );

    await expect(
      processor.process({ data: { ...slackJob(), ...patch } } as Job<MessageSendJob>),
    ).rejects.toThrow('Outbound delivery route mismatch: message-1');

    expect(findByExternalWorkspace).not.toHaveBeenCalled();
    expect(slack.sendMessage).not.toHaveBeenCalled();
    expect(updateMessageDelivery).not.toHaveBeenCalled();
    expect(activateDeliveredConfirmation).not.toHaveBeenCalled();
  });

  it('sends rollout first contact to an active non-Pulse Person once and records the receipt', async () => {
    const sentAt = new Date('2026-09-26T10:00:00.000Z');
    slack.sendMessage.mockResolvedValue({ externalMessageId: '1790416800.000001', sentAt });
    const claimOnboardingDelivery = vi.fn().mockResolvedValue(true);
    const completeOnboardingDelivery = vi.fn().mockResolvedValue(undefined);
    const isUserRuntimeEligible = vi.fn().mockResolvedValue(false);
    const repo = {
      findOutboundMessageForDelivery: vi.fn().mockResolvedValue({
        userId: 'manager-1', text: 'Welcome', sentAt: null,
        onboardingDeliveryId: 'message-1',
        channelType: 'slack', externalConversationId: 'channel-1',
      }),
      findOnboardingDelivery: vi.fn().mockResolvedValue({ status: 'pending', externalWorkspaceId: 'workspace-1' }),
      isUserOnboardingEligible: vi.fn().mockResolvedValue(true), isUserRuntimeEligible,
      claimOnboardingDelivery, completeOnboardingDelivery,
      updateMessageDelivery: vi.fn().mockResolvedValue(sentAt),
    };
    const processor = new MessageSendProcessor(
      { findByExternalWorkspace: vi.fn().mockResolvedValue({ botToken: 'test-token' }) } as never,
      repo as never,
      { activateDeliveredConfirmation: vi.fn().mockResolvedValue(false) } as never,
    );

    await processor.process({ data: slackJob() } as Job<MessageSendJob>);

    expect(isUserRuntimeEligible).not.toHaveBeenCalled();
    expect(claimOnboardingDelivery).toHaveBeenCalledOnce();
    expect(slack.sendMessage).toHaveBeenCalledOnce();
    expect(completeOnboardingDelivery).toHaveBeenCalledWith('message-1', 'tenant-1', 'manager-1', sentAt, '1790416800.000001');
  });

  it('does not resend an onboarding message after a prior sender claimed it', async () => {
    const processor = new MessageSendProcessor(
      { findByExternalWorkspace: vi.fn().mockResolvedValue({ botToken: 'test-token' }) } as never,
      {
        findOutboundMessageForDelivery: vi.fn().mockResolvedValue({
          userId: 'manager-1', text: 'Welcome', sentAt: null,
          onboardingDeliveryId: 'message-1',
          channelType: 'slack', externalConversationId: 'channel-1',
        }),
        findOnboardingDelivery: vi.fn().mockResolvedValue({ status: 'sending', externalWorkspaceId: 'workspace-1' }),
        isUserOnboardingEligible: vi.fn().mockResolvedValue(true),
        claimOnboardingDelivery: vi.fn().mockResolvedValue(false),
      } as never,
      { activateDeliveredConfirmation: vi.fn() } as never,
    );

    await processor.process({ data: slackJob() } as Job<MessageSendJob>);

    expect(slack.sendMessage).not.toHaveBeenCalled();
  });
});

function slackJob(): MessageSendJob {
  return {
    messageId: 'message-1',
    tenantId: 'tenant-1',
    conversationId: 'conversation-1',
    channelType: 'slack',
    externalWorkspaceId: 'workspace-1',
    externalChannelId: 'channel-1',
  };
}
