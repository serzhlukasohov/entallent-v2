import { describe, expect, it, vi } from 'vitest';
import { OutboxService } from './outbox.service';

describe('OutboxService', () => {
  it('queues message identity without duplicating private text in Redis', async () => {
    const add = vi.fn().mockResolvedValue(undefined);
    const outbox = new OutboxService(
      { add } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await outbox.enqueueMessageSend({
      messageId: 'message-1',
      tenantId: 'tenant-1',
      conversationId: 'conversation-1',
      channelType: 'slack',
      externalWorkspaceId: 'workspace-1',
      externalChannelId: 'channel-1',
      text: 'private employee detail',
    });

    expect(add).toHaveBeenCalledWith('send', {
      messageId: 'message-1',
      tenantId: 'tenant-1',
      conversationId: 'conversation-1',
      channelType: 'slack',
      externalWorkspaceId: 'workspace-1',
      externalChannelId: 'channel-1',
      replyToExternalThreadId: undefined,
    }, { jobId: 'message-send-message-1' });
  });

  it('uses the same queue identity when one persisted outbound is enqueued again', async () => {
    const add = vi.fn().mockResolvedValue(undefined);
    const outbox = new OutboxService(
      { add } as never, {} as never, {} as never, {} as never,
      {} as never, {} as never, {} as never,
    );
    const payload = {
      messageId: 'message-1', tenantId: 'tenant-1', conversationId: 'conversation-1',
      channelType: 'slack', externalWorkspaceId: 'workspace-1',
      externalChannelId: 'channel-1', text: 'private employee detail',
    };

    await outbox.enqueueMessageSend(payload);
    await outbox.enqueueMessageSend(payload);

    expect(add).toHaveBeenCalledTimes(2);
    expect(add.mock.calls.map((call) => call[2]?.jobId))
      .toEqual(['message-send-message-1', 'message-send-message-1']);
  });

  it('uses the inbound identity for replayable memory, style, and survey jobs', async () => {
    const memoryAdd = vi.fn().mockResolvedValue(undefined);
    const evidenceAdd = vi.fn().mockResolvedValue(undefined);
    const styleAdd = vi.fn().mockResolvedValue(undefined);
    const outbox = new OutboxService(
      {} as never, { add: memoryAdd } as never, {} as never,
      { add: evidenceAdd } as never, {} as never, { add: styleAdd } as never,
      {} as never,
    );

    await outbox.enqueueMemoryExtraction({
      conversationId: 'conversation-1', userId: 'user-1', tenantId: 'tenant-1',
      inboundMessageId: 'inbound-1', outboundMessageId: 'outbound-1',
      traceId: 'trace-1', channelType: 'slack', externalConversationId: 'channel-1',
    });
    await outbox.enqueueStyleAnalysis({
      conversationId: 'conversation-1', userId: 'user-1', tenantId: 'tenant-1',
      inboundMessageId: 'inbound-1', traceId: 'trace-1',
    });
    await outbox.enqueueSurveyEvidence({
      conversationId: 'conversation-1', userId: 'user-1', tenantId: 'tenant-1',
      inboundMessageId: 'inbound-1', traceId: 'trace-1',
    });

    expect(memoryAdd.mock.calls[0]?.[2]).toEqual({ jobId: 'memory-extraction-inbound-1' });
    expect(styleAdd.mock.calls[0]?.[2]).toEqual({ jobId: 'style-analysis-inbound-1' });
    expect(evidenceAdd.mock.calls[0]?.[2]).toEqual({ jobId: 'survey-evidence-inbound-1' });
  });
});
