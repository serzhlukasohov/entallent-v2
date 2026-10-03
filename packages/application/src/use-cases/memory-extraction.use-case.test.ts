import { describe, expect, it, vi } from 'vitest';
import type { AiProviderPort } from '../ports/ai-provider.port';
import type { ConversationRepositoryPort } from '../ports/conversation.repository.port';
import type { GoalRepositoryPort } from '../ports/goal.repository.port';
import type { MemoryRepositoryPort } from '../ports/memory.repository.port';
import { MemoryExtractionUseCase } from './memory-extraction.use-case';

const input = {
  conversationId: 'conversation-1',
  userId: 'user-1',
  tenantId: 'tenant-1',
  inboundMessageId: 'inbound-1',
  outboundMessageId: 'outbound-1',
  channelType: 'slack',
  externalConversationId: 'slack-dm-1',
};

function makeDependencies(dialogueAct: 'closing' | 'request') {
  const conversationRepo = {
    findRecentMessages: vi.fn().mockResolvedValue([
      {
        id: input.inboundMessageId,
        conversationId: input.conversationId,
        tenantId: input.tenantId,
        userId: input.userId,
        direction: 'inbound',
        text: 'No, forget',
        occurredAt: new Date('2026-08-28T10:36:18Z'),
        createdAt: new Date('2026-08-28T10:36:18Z'),
      },
      {
        id: input.outboundMessageId,
        conversationId: input.conversationId,
        tenantId: input.tenantId,
        userId: input.userId,
        direction: 'outbound',
        text: "Understood — I'll drop the earlier thread and leave it there.",
        occurredAt: new Date('2026-08-28T10:36:21Z'),
        createdAt: new Date('2026-08-28T10:36:21Z'),
        metadata: { dialogueAct },
      },
    ]),
  } as unknown as ConversationRepositoryPort;
  const memoryRepo = {
    findActiveByUser: vi.fn().mockResolvedValue([]),
    findByCanonicalKey: vi.fn().mockResolvedValue(null),
    findById: vi.fn().mockResolvedValue(null),
    save: vi.fn().mockResolvedValue({}),
    supersede: vi.fn().mockResolvedValue(undefined),
    softDelete: vi.fn().mockResolvedValue(undefined),
  } as unknown as MemoryRepositoryPort;
  const goalRepo = {
    findActiveByUser: vi.fn().mockResolvedValue([
      { id: 'goal-existing', title: 'Explain prior assumptions', status: 'active' },
    ]),
    findById: vi.fn().mockResolvedValue(null),
    save: vi.fn().mockResolvedValue({}),
    updateStatus: vi.fn().mockResolvedValue(undefined),
  } as unknown as GoalRepositoryPort;
  const ai = {
    extractMemory: vi.fn().mockResolvedValue({
      memoryItems: [
        {
          category: 'goal',
          content: 'Employee no longer wants to continue the request for evaluation criteria.',
          confidence: 0.9,
          importance: 0.7,
          sensitivity: 'normal',
          expectedLifetime: 'long_term',
          sourceMessageIds: [input.inboundMessageId],
          action: 'create',
        },
      ],
      goalProposals: [
        {
          title: 'Stop discussing evaluation criteria',
          category: 'preference',
          confidence: 0.9,
          sourceMessageIds: [input.inboundMessageId],
          action: 'create',
        },
        {
          title: 'Explain prior assumptions',
          category: 'analysis',
          confidence: 0.9,
          sourceMessageIds: [input.inboundMessageId],
          action: 'cancel',
          existingGoalId: 'goal-existing',
        },
      ],
      commitmentProposals: [],
      followUpCandidates: [
        {
          type: 'follow_up',
          topic: 'evaluation criteria',
          reason: 'The topic was discussed',
          recommendedDelayDays: 3,
          earliestDaysFromNow: 2,
          relevanceChecks: [],
          cancellationConditions: [],
          messageStrategy: 'light_check_in',
          confidence: 0.9,
        },
      ],
    }),
  } as unknown as AiProviderPort;

  return { conversationRepo, memoryRepo, goalRepo, ai };
}

describe('MemoryExtractionUseCase', () => {
  it('prepares model output without durable memory or goal writes', async () => {
    const dependencies = makeDependencies('request');
    const useCase = new MemoryExtractionUseCase(
      dependencies.conversationRepo, dependencies.memoryRepo,
      dependencies.goalRepo, dependencies.ai,
    );

    const prepared = await useCase.prepare(input);

    expect(prepared?.proposal.memoryItems).toHaveLength(1);
    expect(dependencies.memoryRepo.save).not.toHaveBeenCalled();
    expect(dependencies.goalRepo.save).not.toHaveBeenCalled();
    await useCase.apply(input, prepared!);
    expect(dependencies.memoryRepo.save).toHaveBeenCalledOnce();
    expect(dependencies.goalRepo.save).toHaveBeenCalledOnce();
  });

  it('does not turn a closing turn into durable memory, a new goal, or a follow-up', async () => {
    const dependencies = makeDependencies('closing');
    const result = await new MemoryExtractionUseCase(
      dependencies.conversationRepo,
      dependencies.memoryRepo,
      dependencies.goalRepo,
      dependencies.ai,
    ).execute(input);

    expect(dependencies.memoryRepo.save).not.toHaveBeenCalled();
    expect(dependencies.goalRepo.save).not.toHaveBeenCalled();
    expect(dependencies.goalRepo.updateStatus).toHaveBeenCalledWith(
      'goal-existing',
      'cancelled',
      input.tenantId,
    );
    expect(result.followUpCandidates).toEqual([]);
  });

  it('keeps normal extraction behavior for a substantive request', async () => {
    const dependencies = makeDependencies('request');
    const result = await new MemoryExtractionUseCase(
      dependencies.conversationRepo,
      dependencies.memoryRepo,
      dependencies.goalRepo,
      dependencies.ai,
    ).execute(input);

    expect(dependencies.memoryRepo.save).toHaveBeenCalledOnce();
    expect(dependencies.goalRepo.save).toHaveBeenCalledOnce();
    expect(result.followUpCandidates).toHaveLength(1);
  });

  it('excludes later turns when a committed extraction job runs late', async () => {
    const dependencies = makeDependencies('request');
    const source = {
      id: input.inboundMessageId, conversationId: input.conversationId,
      tenantId: input.tenantId, userId: input.userId, direction: 'inbound' as const,
      text: 'I want to grow at work.', occurredAt: new Date('2026-08-28T10:36:18Z'),
      createdAt: new Date('2026-08-28T10:36:18Z'),
    };
    const reply = {
      id: input.outboundMessageId, conversationId: input.conversationId,
      tenantId: input.tenantId, userId: input.userId, direction: 'outbound' as const,
      text: 'What kind of growth matters to you?', occurredAt: new Date('2026-08-28T10:36:21Z'),
      createdAt: new Date('2026-08-28T10:36:21Z'),
      metadata: { sourceInboundMessageId: input.inboundMessageId, dialogueAct: 'request' },
    };
    dependencies.conversationRepo.findMessagesThrough = vi.fn().mockResolvedValue([source]);
    dependencies.conversationRepo.findMessageById = vi.fn().mockResolvedValue(reply);
    dependencies.conversationRepo.findRecentMessages = vi.fn().mockResolvedValue([
      source, reply, { ...source, id: 'future-inbound', text: 'Private later disclosure' },
    ]);

    await new MemoryExtractionUseCase(
      dependencies.conversationRepo, dependencies.memoryRepo,
      dependencies.goalRepo, dependencies.ai,
    ).execute(input);

    expect(dependencies.conversationRepo.findRecentMessages).not.toHaveBeenCalled();
    const turns = vi.mocked(dependencies.ai.extractMemory).mock.calls[0]?.[0];
    expect(turns?.map((turn) => turn.content)).toEqual([
      'I want to grow at work.', 'What kind of growth matters to you?',
    ]);
  });

  it('rejects a reply linked to a different inbound before model extraction', async () => {
    const dependencies = makeDependencies('request');
    dependencies.conversationRepo.findMessagesThrough = vi.fn().mockResolvedValue([{
      id: input.inboundMessageId, conversationId: input.conversationId,
      tenantId: input.tenantId, userId: input.userId, direction: 'inbound',
    }]);
    dependencies.conversationRepo.findMessageById = vi.fn().mockResolvedValue({
      id: input.outboundMessageId, conversationId: input.conversationId,
      tenantId: input.tenantId, userId: input.userId, direction: 'outbound',
      metadata: { sourceInboundMessageId: 'other-inbound' },
    });

    await expect(new MemoryExtractionUseCase(
      dependencies.conversationRepo, dependencies.memoryRepo,
      dependencies.goalRepo, dependencies.ai,
    ).execute(input)).rejects.toThrow('memory_extraction_message_scope_mismatch');
    expect(dependencies.ai.extractMemory).not.toHaveBeenCalled();
    expect(dependencies.memoryRepo.save).not.toHaveBeenCalled();
  });
});
