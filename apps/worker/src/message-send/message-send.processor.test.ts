import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Job } from 'bullmq';
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
});

describe('MessageSendProcessor', () => {
  it('marks a logged dev response delivered', async () => {
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
    const processor = new MessageSendProcessor(
      {} as never,
      { updateMessageDelivery, findOutboundMessageForDelivery, findOnboardingDelivery: vi.fn().mockResolvedValue(null), isUserRuntimeEligible: vi.fn().mockResolvedValue(true) } as never,
      { activateDeliveredConfirmation } as never, {} as never,
    );
    const data: MessageSendJob = {
      messageId: 'message-1',
      tenantId: 'tenant-1',
      conversationId: 'conversation-1',
      channelType: 'dev',
      externalWorkspaceId: 'workspace-1',
      externalChannelId: 'channel-1',
      text: 'response',
    };

    await processor.process({ data } as Job<MessageSendJob>);

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
      { activateDeliveredConfirmation } as never, {} as never,
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
    slack.sendMessage.mockRejectedValue(new Error('slack unavailable'));
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
      { activateDeliveredConfirmation } as never, {} as never,
    );

    await expect(
      processor.process({ data: slackJob() } as Job<MessageSendJob>),
    ).rejects.toThrow('slack unavailable');
    expect(updateMessageDelivery).not.toHaveBeenCalled();
    expect(activateDeliveredConfirmation).not.toHaveBeenCalled();
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
      { activateDeliveredConfirmation } as never, {} as never,
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
      { activateDeliveredConfirmation } as never, {} as never,
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
      { activateDeliveredConfirmation } as never, {} as never,
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
      { activateDeliveredConfirmation: vi.fn().mockResolvedValue(false) } as never, {} as never,
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
      { activateDeliveredConfirmation: vi.fn() } as never, {} as never,
    );

    await processor.process({ data: slackJob() } as Job<MessageSendJob>);

    expect(slack.sendMessage).not.toHaveBeenCalled();
  });

  describe('onboarding-originated messages', () => {
    const data: MessageSendJob = {
      messageId: 'm1', tenantId: 't1', conversationId: 'c1', channelType: 'dev',
      externalWorkspaceId: 'w1', externalChannelId: 'ch1', text: 'x',
    };
    function build(messageType: string, onboardingEligible: boolean) {
      const repo = {
        findOutboundMessageForDelivery: vi.fn().mockResolvedValue({
          userId: 'u1', text: 'x', sentAt: null, channelType: 'dev', externalConversationId: 'ch1', messageType,
        }),
        findOnboardingDelivery: vi.fn().mockResolvedValue(null),
        // managers have no pulse participation: runtime eligibility is false for them
        isUserRuntimeEligible: vi.fn().mockResolvedValue(false),
        isUserOnboardingEligible: vi.fn().mockResolvedValue(onboardingEligible),
        updateMessageDelivery: vi.fn().mockResolvedValue(new Date()),
      };
      const processor = new MessageSendProcessor({} as never, repo as never,
        { activateDeliveredConfirmation: vi.fn().mockResolvedValue(false) } as never, {} as never,
    );
      return { processor, repo };
    }

    it.each(['onboarding_ack', 'onboarding_intro', 'onboarding_reminder'])('sends %s to a non-pulse manager', async (type) => {
      const { processor, repo } = build(type, true);
      await processor.process({ data } as Job<MessageSendJob>);
      expect(repo.updateMessageDelivery).toHaveBeenCalled();
      expect(repo.isUserRuntimeEligible).not.toHaveBeenCalled();
    });

    it('still skips a normal message for the same manager', async () => {
      const { processor, repo } = build('text', true);
      await processor.process({ data } as Job<MessageSendJob>);
      expect(repo.updateMessageDelivery).not.toHaveBeenCalled();
    });

    it('skips onboarding_ack for an ineligible user', async () => {
      const { processor, repo } = build('onboarding_ack', false);
      await processor.process({ data } as Job<MessageSendJob>);
      expect(repo.updateMessageDelivery).not.toHaveBeenCalled();
    });
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
    text: 'response',
  };
}

describe('onboarding intro buttons', () => {
  const sentAt = new Date('2026-09-03T10:00:00.000Z');
  const actions = [
    { actionId: 'onboarding:start', label: 'Start My Conversation', value: 'start' },
    { actionId: 'onboarding:got_it', label: 'Got It', value: 'got_it' },
    { actionId: 'onboarding:later', label: 'Later', value: 'later' },
    { actionId: 'onboarding:decline', label: 'No Personal Check-ins', value: 'decline' },
  ];

  function build(metadata: Record<string, unknown>, calls: string[] = []) {
    const repo = {
      findOutboundMessageForDelivery: vi.fn().mockResolvedValue({
        userId: 'lead-1', text: 'Trust copy', sentAt: null, messageType: 'onboarding_intro', metadata,
        onboardingDeliveryId: null, channelType: 'slack', externalConversationId: 'channel-1',
      }),
      findOnboardingDelivery: vi.fn().mockResolvedValue(null),
      isUserOnboardingEligible: vi.fn().mockResolvedValue(true),
      updateMessageDelivery: vi.fn().mockResolvedValue(sentAt),
    };
    const onboarding = { recordIntroDelivered: vi.fn(async () => { calls.push('intro_delivered'); }) };
    const processor = new MessageSendProcessor(
      { findByExternalWorkspace: vi.fn().mockResolvedValue({ botToken: 'tok' }) } as never,
      repo as never,
      { activateDeliveredConfirmation: vi.fn().mockResolvedValue(false) } as never,
      onboarding as never,
    );
    return { processor, onboarding, calls };
  }

  it('sends the trust message with its buttons and records intro delivery after Slack resolves', async () => {
    const calls: string[] = [];
    slack.sendMessage.mockImplementation(async () => {
      calls.push('sendMessage');
      return { externalMessageId: '1788430496.000200', sentAt };
    });
    const { processor, onboarding } = build({ onboardingIntroPart: 'trust', onboardingActions: actions }, calls);

    await processor.process({ data: slackJob() } as Job<MessageSendJob>);

    expect(slack.sendMessage).toHaveBeenCalledWith(expect.objectContaining({ actions }));
    expect(onboarding.recordIntroDelivered).toHaveBeenCalledWith('tenant-1', 'lead-1', 'channel-1', '1788430496.000200', sentAt);
    expect(calls).toEqual(['sendMessage', 'intro_delivered']);
  });

  it('does not apply intro delivery when Slack fails', async () => {
    slack.sendMessage.mockRejectedValue(new Error('slack unavailable'));
    const { processor, onboarding } = build({ onboardingIntroPart: 'trust', onboardingActions: actions });
    await expect(processor.process({ data: slackJob() } as Job<MessageSendJob>)).rejects.toThrow('slack unavailable');
    expect(onboarding.recordIntroDelivered).not.toHaveBeenCalled();
  });

  it('does not treat the first intro half or a button-less trust message as intro delivery', async () => {
    slack.sendMessage.mockResolvedValue({ externalMessageId: '1.1', sentAt });
    const first = build({ onboardingIntroPart: 'intro' });
    await first.processor.process({ data: slackJob() } as Job<MessageSendJob>);
    const noButtons = build({ onboardingIntroPart: 'trust', onboardingActions: [] });
    await noButtons.processor.process({ data: slackJob() } as Job<MessageSendJob>);
    expect(first.onboarding.recordIntroDelivered).not.toHaveBeenCalled();
    expect(noButtons.onboarding.recordIntroDelivered).not.toHaveBeenCalled();
    expect(slack.sendMessage).toHaveBeenLastCalledWith(expect.not.objectContaining({ actions: expect.anything() }));
  });
});

