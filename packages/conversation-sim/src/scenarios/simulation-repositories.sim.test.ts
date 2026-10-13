import { describe, expect, it } from 'vitest';
import { InMemoryConversationRepository, InMemoryStyleProfileRepository } from '../fakes/repositories';

const scope = { conversationId: 'conversation-1', tenantId: 'tenant-1', userId: 'user-1' };

describe('simulation repositories for committed work', () => {
  it('keeps delayed analysis history bounded by its scoped inbound source', async () => {
    const repo = new InMemoryConversationRepository({
      id: scope.conversationId, tenantId: scope.tenantId, userId: scope.userId,
      channelType: 'sim', externalConversationId: 'sim-channel', status: 'active',
    } as never);
    const first = await repo.saveMessage({ ...scope, direction: 'inbound', text: 'First',
      occurredAt: new Date('2026-01-01T10:00:00.000Z') });
    await repo.saveMessage({ ...scope, direction: 'inbound', text: 'Later',
      occurredAt: new Date('2026-01-01T10:01:00.000Z') });

    expect((await repo.findMessagesThrough({ ...scope, inboundMessageId: first.id, limit: 30 }))
      .map((message) => message.text)).toEqual(['First']);
    expect(await repo.findMessagesThrough({ ...scope, userId: 'other',
      inboundMessageId: first.id, limit: 30 })).toEqual([]);
  });

  it('applies a committed style update once for the same scoped source', async () => {
    const repo = new InMemoryStyleProfileRepository();
    const input = { ...scope, inboundMessageId: 'inbound-1' };
    const update = () => ({ userId: scope.userId, tenantId: scope.tenantId,
      version: 1 } as never);

    await repo.completeCommittedStyleAnalysis(input, update);
    await repo.completeCommittedStyleAnalysis(input, () => { throw new Error('duplicate update'); });

    expect(await repo.isCommittedStyleAnalysisComplete(input)).toBe(true);
    expect(await repo.isCommittedStyleAnalysisComplete({ ...input, userId: 'other' })).toBe(false);
    expect(await repo.findByUser(scope.userId, scope.tenantId)).toMatchObject({ version: 1 });
  });
});
