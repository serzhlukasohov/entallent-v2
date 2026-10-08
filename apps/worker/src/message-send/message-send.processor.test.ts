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
      { activateDeliveredConfirmation } as never, {} as never, {} as never,
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
      { activateDeliveredConfirmation } as never, {} as never, {} as never,
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
      { activateDeliveredConfirmation } as never, {} as never, {} as never,
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
      { activateDeliveredConfirmation } as never, {} as never, {} as never,
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
      { activateDeliveredConfirmation } as never, {} as never, {} as never,
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
      { activateDeliveredConfirmation } as never, {} as never, {} as never,
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
      { activateDeliveredConfirmation: vi.fn().mockResolvedValue(false) } as never, {} as never, {} as never,
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
      { activateDeliveredConfirmation: vi.fn() } as never, {} as never, {} as never,
    );

    await processor.process({ data: slackJob() } as Job<MessageSendJob>);

    expect(slack.sendMessage).not.toHaveBeenCalled();
  });

  describe('onboarding-originated messages', () => {
    const data: MessageSendJob = {
      messageId: 'm1', tenantId: 't1', conversationId: 'c1', channelType: 'dev',
      externalWorkspaceId: 'w1', externalChannelId: 'ch1', text: 'x',
    };
    function build(messageType: string, onboardingEligible: boolean, participation: string | null = 'undecided', track = 'employee') {
      const contextFor = vi.fn().mockResolvedValue(participation ? { state: { participation, track } } : null);
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
        { activateDeliveredConfirmation: vi.fn().mockResolvedValue(false) } as never, { contextFor } as never, {} as never,
    );
      return { processor, repo, contextFor };
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

    it.each(['undecided', 'deferred'])('sends onboarding_reminder while participation is %s', async (p) => {
      const { processor, repo } = build('onboarding_reminder', true, p);
      await processor.process({ data } as Job<MessageSendJob>);
      expect(repo.updateMessageDelivery).toHaveBeenCalled();
    });

    it.each(['declined', 'active', 'not_applicable', null])(
      'send-time re-check: skips onboarding_reminder when participation is %s', async (p) => {
        const { processor, repo, contextFor } = build('onboarding_reminder', true, p);
        await processor.process({ data } as Job<MessageSendJob>);
        expect(contextFor).toHaveBeenCalledWith('t1', 'u1');
        expect(repo.updateMessageDelivery).not.toHaveBeenCalled();
      });

    it('send-time re-check: skips onboarding_reminder for the management track', async () => {
      const { processor, repo } = build('onboarding_reminder', true, 'undecided', 'management');
      await processor.process({ data } as Job<MessageSendJob>);
      expect(repo.updateMessageDelivery).not.toHaveBeenCalled();
    });

    it('skips onboarding_reminder for an inactive user', async () => {
      const { processor, repo } = build('onboarding_reminder', false);
      await processor.process({ data } as Job<MessageSendJob>);
      expect(repo.updateMessageDelivery).not.toHaveBeenCalled();
    });

    it('does not apply the participation re-check to other onboarding messages', async () => {
      const { processor, repo, contextFor } = build('onboarding_ack', true, 'declined');
      await processor.process({ data } as Job<MessageSendJob>);
      expect(contextFor).not.toHaveBeenCalled();
      expect(repo.updateMessageDelivery).toHaveBeenCalled();
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
      { enqueueTrustAfterIntro: vi.fn().mockResolvedValue(undefined) } as never,
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
    expect(onboarding.recordIntroDelivered).toHaveBeenCalledWith('tenant-1', 'lead-1', 'channel-1', '1788430496.000200', sentAt, false);
    expect(calls).toEqual(['sendMessage', 'intro_delivered']);
  });

  it('passes the role-change marker of the trust message through to intro delivery', async () => {
    slack.sendMessage.mockResolvedValue({ externalMessageId: '1788430496.000300', sentAt });
    const { processor, onboarding } = build({ onboardingIntroPart: 'trust', onboardingRoleChange: true, onboardingActions: actions });
    await processor.process({ data: slackJob() } as Job<MessageSendJob>);
    expect(onboarding.recordIntroDelivered).toHaveBeenCalledWith('tenant-1', 'lead-1', 'channel-1', '1788430496.000300', sentAt, true);
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

  describe('two-message onboarding intro chain', () => {
    const introMeta = { onboardingDeliveryId: 'message-1', onboardingIntroPart: 'intro', onboardingTrustMessageId: 'trust-1' };
    function build(sentAt: Date | null, metadata: Record<string, unknown>) {
      const when = new Date('2026-10-07T10:00:00.000Z');
      slack.sendMessage.mockResolvedValue({ externalMessageId: '1.1', sentAt: when });
      const repo = {
        findOutboundMessageForDelivery: vi.fn().mockResolvedValue({
          userId: 'user-1', text: 'intro text', sentAt, externalMessageId: sentAt ? '1.1' : null,
          onboardingDeliveryId: 'message-1', messageType: 'onboarding_intro', metadata,
          channelType: 'slack', externalConversationId: 'channel-1',
        }),
        findOnboardingDelivery: vi.fn().mockResolvedValue({ status: 'pending', externalWorkspaceId: 'workspace-1' }),
        isUserOnboardingEligible: vi.fn().mockResolvedValue(true),
        claimOnboardingDelivery: vi.fn().mockResolvedValue(true),
        completeOnboardingDelivery: vi.fn().mockResolvedValue(undefined),
        updateMessageDelivery: vi.fn().mockResolvedValue(when),
      };
      const intro = { enqueueTrustAfterIntro: vi.fn().mockResolvedValue(undefined) };
      const onboarding = { recordIntroDelivered: vi.fn() };
      const processor = new MessageSendProcessor(
        { findByExternalWorkspace: vi.fn().mockResolvedValue({ botToken: 't' }) } as never, repo as never,
        { activateDeliveredConfirmation: vi.fn() } as never, onboarding as never, intro as never,
      );
      return { processor, intro, onboarding };
    }

    it('queues the trust message after the intro part is delivered, without recording intro delivery', async () => {
      const { processor, intro, onboarding } = build(null, introMeta);
      await processor.process({ data: slackJob() } as Job<MessageSendJob>);
      expect(slack.sendMessage).toHaveBeenCalledOnce();
      expect(onboarding.recordIntroDelivered).not.toHaveBeenCalled();
      expect(intro.enqueueTrustAfterIntro).toHaveBeenCalledWith(expect.objectContaining({
        tenantId: 'tenant-1', conversationId: 'conversation-1', introMetadata: introMeta,
      }));
    });

    it('re-queues the trust message on a retry after the intro was already sent', async () => {
      const { processor, intro } = build(new Date('2026-10-07T10:00:00.000Z'), introMeta);
      await processor.process({ data: slackJob() } as Job<MessageSendJob>);
      expect(slack.sendMessage).not.toHaveBeenCalled();
      expect(intro.enqueueTrustAfterIntro).toHaveBeenCalledOnce();
    });

    it('does not chain when the intro send fails', async () => {
      const { processor, intro } = build(null, introMeta);
      slack.sendMessage.mockRejectedValue(new Error('slack down'));
      await expect(processor.process({ data: slackJob() } as Job<MessageSendJob>)).rejects.toThrow('slack down');
      expect(intro.enqueueTrustAfterIntro).not.toHaveBeenCalled();
    });
  });
});

describe('dev channel onboarding buttons (local dev console)', () => {
  const actions = [
    { actionId: 'onboarding:start', label: "Let's Talk", value: 'start' },
    { actionId: 'onboarding:later', label: 'Later', value: 'later' },
    { actionId: 'onboarding:decline', label: "I Don't Want to Participate", value: 'decline' },
  ];
  const devJob: MessageSendJob = {
    messageId: 'trust-1', tenantId: 't1', conversationId: 'c1', channelType: 'dev',
    externalWorkspaceId: 'dev-workspace', externalChannelId: 'dev-conv-alice', text: 'x',
  };

  function build(metadata: Record<string, unknown>) {
    const sentAt = new Date('2026-10-08T10:00:00.000Z');
    const repo = {
      findOutboundMessageForDelivery: vi.fn().mockResolvedValue({
        userId: 'p1', text: 'Trust copy', sentAt: null, messageType: 'onboarding_intro', metadata,
        channelType: 'dev', externalConversationId: 'dev-conv-alice',
      }),
      findOnboardingDelivery: vi.fn().mockResolvedValue(null),
      isUserOnboardingEligible: vi.fn().mockResolvedValue(true),
      updateMessageDelivery: vi.fn().mockResolvedValue(sentAt),
    };
    const onboarding = { recordIntroDelivered: vi.fn().mockResolvedValue({ changed: true }) };
    const intro = { enqueueTrustAfterIntro: vi.fn().mockResolvedValue(undefined) };
    const processor = new MessageSendProcessor({} as never, repo as never,
      { activateDeliveredConfirmation: vi.fn().mockResolvedValue(false) } as never, onboarding as never, intro as never);
    return { processor, repo, onboarding, intro, sentAt };
  }

  it('records intro delivery for a dev trust message with buttons, using a Slack-like ts', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-08T10:00:00.123Z'));
    const log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const { processor, repo, onboarding } = build({ onboardingIntroPart: 'trust', onboardingActions: actions });
    await processor.process({ data: devJob } as Job<MessageSendJob>);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("[DEV BUTTONS] Let's Talk | Later | I Don't Want to Participate"));
    log.mockRestore();
    expect(repo.isUserOnboardingEligible).toHaveBeenCalledWith('t1', 'p1', 'dev-workspace', 'dev');
    expect(repo.updateMessageDelivery).toHaveBeenCalledWith('trust-1', expect.objectContaining({ externalMessageId: '1791453600.123000' }));
    expect(onboarding.recordIntroDelivered).toHaveBeenCalledWith('t1', 'p1', 'dev-conv-alice', '1791453600.123000', new Date('2026-10-08T10:00:00.123Z'), false);
  });

  it('passes the role-change marker through on the dev channel', async () => {
    const { processor, onboarding } = build({ onboardingIntroPart: 'trust', onboardingRoleChange: true, onboardingActions: actions });
    await processor.process({ data: devJob } as Job<MessageSendJob>);
    expect(onboarding.recordIntroDelivered).toHaveBeenCalledWith('t1', 'p1', 'dev-conv-alice', expect.stringMatching(/^\d+\.\d{6}$/), expect.any(Date), true);
  });

  it.each([
    ['the first intro half', { onboardingIntroPart: 'intro', onboardingTrustMessageId: 'trust-2' }],
    ['a button-less trust message', { onboardingIntroPart: 'trust', onboardingActions: [] }],
    ['an ordinary message', {}],
  ])('does not record intro delivery for %s', async (_label, metadata) => {
    const { processor, repo, onboarding } = build(metadata);
    await processor.process({ data: devJob } as Job<MessageSendJob>);
    expect(onboarding.recordIntroDelivered).not.toHaveBeenCalled();
    expect(repo.updateMessageDelivery).toHaveBeenCalledWith('trust-1', expect.objectContaining({ externalMessageId: 'dev:trust-1' }));
  });

  it('checks Slack onboarding eligibility for Slack deliveries', async () => {
    slack.sendMessage.mockResolvedValue({ externalMessageId: '1.1', sentAt: new Date() });
    const repo = {
      findOutboundMessageForDelivery: vi.fn().mockResolvedValue({
        userId: 'u1', text: 'x', sentAt: null, messageType: 'onboarding_ack', channelType: 'slack', externalConversationId: 'channel-1',
      }),
      findOnboardingDelivery: vi.fn().mockResolvedValue(null),
      isUserOnboardingEligible: vi.fn().mockResolvedValue(true),
      updateMessageDelivery: vi.fn().mockResolvedValue(new Date()),
    };
    const processor = new MessageSendProcessor({ findByExternalWorkspace: vi.fn().mockResolvedValue({ botToken: 't' }) } as never,
      repo as never, { activateDeliveredConfirmation: vi.fn() } as never, {} as never, { enqueueTrustAfterIntro: vi.fn() } as never);
    await processor.process({ data: slackJob() } as Job<MessageSendJob>);
    expect(repo.isUserOnboardingEligible).toHaveBeenCalledWith('tenant-1', 'u1', 'workspace-1', 'slack');
  });
});
