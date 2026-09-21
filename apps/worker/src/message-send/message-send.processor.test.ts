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
      text: 'persisted response',
      sentAt: null,
      channelType: 'dev',
      externalConversationId: 'channel-1',
    });
    const activateDeliveredConfirmation = vi.fn().mockResolvedValue(false);
    const processor = new MessageSendProcessor(
      {} as never,
      { updateMessageDelivery, findOutboundMessageForDelivery } as never,
      { activateDeliveredConfirmation } as never,
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
      text: 'persisted exact response',
      sentAt: null,
      channelType: 'slack',
      externalConversationId: 'channel-1',
    });
    const activateDeliveredConfirmation = vi.fn().mockResolvedValue(true);
    const findByExternalWorkspace = vi.fn().mockResolvedValue({ botToken: 'test-token' });
    const processor = new MessageSendProcessor(
      { findByExternalWorkspace } as never,
      { updateMessageDelivery, findOutboundMessageForDelivery } as never,
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
    slack.sendMessage.mockRejectedValue(new Error('slack unavailable'));
    const updateMessageDelivery = vi.fn().mockResolvedValue(undefined);
    const findOutboundMessageForDelivery = vi.fn().mockResolvedValue({
      text: 'persisted response',
      sentAt: null,
      channelType: 'slack',
      externalConversationId: 'channel-1',
    });
    const activateDeliveredConfirmation = vi.fn();
    const processor = new MessageSendProcessor(
      { findByExternalWorkspace: vi.fn().mockResolvedValue({ botToken: 'test-token' }) } as never,
      { updateMessageDelivery, findOutboundMessageForDelivery } as never,
      { activateDeliveredConfirmation } as never,
    );

    await expect(
      processor.process({ data: slackJob() } as Job<MessageSendJob>),
    ).rejects.toThrow('slack unavailable');
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
          text: 'persisted exact response',
          sentAt: deliveredAt,
          channelType: 'slack',
          externalConversationId: 'channel-1',
        }),
        updateMessageDelivery,
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
          text: 'persisted exact response',
          sentAt: null,
          channelType: 'slack',
          externalConversationId: 'channel-1',
        }),
        updateMessageDelivery,
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
