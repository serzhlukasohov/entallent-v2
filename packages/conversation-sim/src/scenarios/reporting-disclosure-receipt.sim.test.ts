import { describe, expect, it } from 'vitest';
import { InMemoryConversationRepository } from '../fakes/repositories';

describe('InMemoryConversationRepository', () => {
  it('treats only an outbox-delivered disclosure as a receipt', async () => {
    const shownAt = new Date('2026-09-03T09:00:00.000Z');
    const version = 'test-disclosure-v1';
    const repository = new InMemoryConversationRepository({
      id: 'conversation-1',
      tenantId: 'tenant-1',
      userId: 'user-1',
      channelType: 'sim',
      externalConversationId: 'sim-channel',
      status: 'active',
    });
    const disclosure = await repository.saveMessage({
      conversationId: 'conversation-1',
      tenantId: 'tenant-1',
      userId: 'user-1',
      direction: 'outbound',
      text: 'Disclosure',
      occurredAt: shownAt,
      metadata: { reportingDisclosureVersion: version },
    });

    await expect(repository.findLatestDeliveredReportingDisclosure(
      'tenant-1',
      'user-1',
      version,
      new Date('2026-09-03T10:00:00.000Z'),
    )).resolves.toBeNull();

    await repository.updateMessageDelivery(disclosure.id, {
      tenantId: 'tenant-1',
      conversationId: 'conversation-1',
      externalMessageId: `sim:${disclosure.id}`,
      sentAt: shownAt,
    });

    await expect(repository.findLatestDeliveredReportingDisclosure(
      'tenant-1',
      'user-1',
      version,
      new Date('2026-09-03T10:00:00.000Z'),
    )).resolves.toEqual({
      version,
      shownAt,
    });
  });
});
