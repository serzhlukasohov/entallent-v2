import type { Queue } from 'bullmq';
import { describe, expect, it, vi } from 'vitest';
import type { ConversationJob } from '../queue/queue.types';
import { SlackIngestService } from './slack-ingest.service';

describe('SlackIngestService rapid-message admission', () => {
  it('persists every inbound and delays every conversation job without queue replacement', async () => {
    const { service, ingestion, queue } = createService(['message-1', 'message-2']);

    await service.processBody(slackMessage('event-1', '1789078586.984529', 'нуі'));
    await service.processBody(slackMessage('event-2', '1789078588.641019', 'yes'));

    expect(ingestion.saveInboundMessage).toHaveBeenCalledTimes(2);
    expect(ingestion.saveInboundMessage).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        externalMessageId: '1789078586.984529',
        occurredAt: new Date(1_789_078_586_984),
      }),
    );
    expect(ingestion.saveInboundMessage).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        externalMessageId: '1789078588.641019',
        occurredAt: new Date(1_789_078_588_641),
      }),
    );
    expect(queue.add).toHaveBeenNthCalledWith(
      1,
      'process',
      expect.objectContaining({
        eventId: 'event-1',
        messageId: 'message-1',
        rapidMessageCoalescing: true,
      }),
      { delay: 2_000 },
    );
    expect(ingestion.saveInboundMessage.mock.invocationCallOrder[0])
      .toBeLessThan(queue.add.mock.invocationCallOrder[0]!);
    expect(ingestion.saveInboundMessage.mock.invocationCallOrder[1])
      .toBeLessThan(queue.add.mock.invocationCallOrder[1]!);
    expect(queue.add).toHaveBeenNthCalledWith(
      2,
      'process',
      expect.objectContaining({
        eventId: 'event-2',
        messageId: 'message-2',
        rapidMessageCoalescing: true,
      }),
      { delay: 2_000 },
    );
  });

  it('keeps Slack replay idempotency ahead of persistence and admission', async () => {
    const { service, idempotency, ingestion, queue } = createService(['message-1']);
    idempotency.isNew.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const event = slackMessage('event-1', '1789078586.984529', 'yes');

    await service.processBody(event);
    await service.processBody(event);

    expect(ingestion.saveInboundMessage).toHaveBeenCalledOnce();
    expect(queue.add).toHaveBeenCalledOnce();
  });
});

function createService(messageIds: string[]) {
  const ingestion = {
    findWorkspaceIdentity: vi.fn().mockResolvedValue({
      tenantId: 'tenant-1',
      signingSecret: 'secret',
    }),
    findOrCreateUser: vi.fn().mockResolvedValue({ userId: 'user-1' }),
    findOrCreateConversation: vi.fn().mockResolvedValue({ conversationId: 'conversation-1' }),
    saveInboundMessage: vi.fn(),
  };
  for (const messageId of messageIds) {
    ingestion.saveInboundMessage.mockResolvedValueOnce({ messageId });
  }
  const idempotency = { isNew: vi.fn().mockResolvedValue(true) };
  const queue = { add: vi.fn().mockResolvedValue({}) };

  return {
    service: new SlackIngestService(
      ingestion as never,
      idempotency as never,
      queue as unknown as Queue<ConversationJob>,
    ),
    ingestion,
    idempotency,
    queue,
  };
}

function slackMessage(eventId: string, ts: string, text: string): Record<string, unknown> {
  return {
    type: 'event_callback',
    event_id: eventId,
    team_id: 'T1',
    event: { type: 'message', user: 'U1', channel: 'D1', text, ts },
  };
}
