import { describe, it, expect, vi } from 'vitest';
import { FollowUpSchedulerUseCase } from './follow-up-scheduler.use-case';
import type { ScheduledActionRepositoryPort } from '../ports/scheduled-action.repository.port';
import type { OutboxPort } from '../ports/outbox.port';
import type { FollowUpCandidate } from '@entalent/contracts';

function makeCandidate(overrides: Partial<FollowUpCandidate> = {}): FollowUpCandidate {
  return {
    type: 'follow_up',
    topic: 'check on project progress',
    reason: 'User mentioned starting a big project',
    recommendedDelayDays: 3,
    earliestDaysFromNow: 2,
    relevanceChecks: ['user has not mentioned completion'],
    cancellationConditions: ['user_mentions_completion'],
    messageStrategy: 'light_check_in',
    confidence: 0.85,
    ...overrides,
  };
}

function makeActionRepo(overrides: Partial<ScheduledActionRepositoryPort> = {}): ScheduledActionRepositoryPort {
  return {
    save: vi.fn().mockResolvedValue({ id: 'action-1', tenantId: 't-1', userId: 'u-1', dueAt: new Date(), status: 'pending', attemptCount: 0, maxAttempts: 3, conversationId: 'c-1', type: 'follow_up', intent: '', context: {}, reason: '', timezone: 'UTC', cancellationConditions: [], deduplicationKey: '', sourceMessageIds: [] }),
    existsByDeduplicationKey: vi.fn().mockResolvedValue(false),
    findById: vi.fn(),
    cancel: vi.fn(),
    markSent: vi.fn(),
    reschedule: vi.fn(),
    ...overrides,
  } as unknown as ScheduledActionRepositoryPort;
}

function makeOutbox(): OutboxPort {
  return {
    enqueueMessageSend: vi.fn(),
    enqueueMemoryExtraction: vi.fn(),
    enqueueFollowUpExecution: vi.fn().mockResolvedValue(undefined),
    enqueueSurveyEvidence: vi.fn(),
  };
}

const baseInput = {
  userId: 'u-1',
  tenantId: 't-1',
  conversationId: 'c-1',
  channelType: 'slack',
  externalConversationId: 'ext-c-1',
  inboundMessageId: 'msg-1',
};

describe('FollowUpSchedulerUseCase', () => {
  it('creates a scheduled action and enqueues execution for high-confidence candidate', async () => {
    const repo = makeActionRepo();
    const outbox = makeOutbox();
    const useCase = new FollowUpSchedulerUseCase(repo, outbox);

    await useCase.schedule({ ...baseInput, candidates: [makeCandidate({ confidence: 0.9 })] });

    expect(repo.save).toHaveBeenCalledOnce();
    expect(outbox.enqueueFollowUpExecution).toHaveBeenCalledOnce();
  });

  it('skips candidates below MIN_CONFIDENCE (0.6)', async () => {
    const repo = makeActionRepo();
    const outbox = makeOutbox();
    const useCase = new FollowUpSchedulerUseCase(repo, outbox);

    await useCase.schedule({ ...baseInput, candidates: [makeCandidate({ confidence: 0.5 })] });

    expect(repo.save).not.toHaveBeenCalled();
    expect(outbox.enqueueFollowUpExecution).not.toHaveBeenCalled();
  });

  it('skips duplicate candidates via deduplication key', async () => {
    const repo = makeActionRepo({ existsByDeduplicationKey: vi.fn().mockResolvedValue(true) });
    const outbox = makeOutbox();
    const useCase = new FollowUpSchedulerUseCase(repo, outbox);

    await useCase.schedule({ ...baseInput, candidates: [makeCandidate()] });

    expect(repo.save).not.toHaveBeenCalled();
  });

  it('processes multiple candidates independently', async () => {
    const repo = makeActionRepo();
    const outbox = makeOutbox();
    const useCase = new FollowUpSchedulerUseCase(repo, outbox);

    const candidates = [
      makeCandidate({ topic: 'project progress', confidence: 0.9 }),
      makeCandidate({ topic: 'team dynamics', confidence: 0.4 }), // below threshold
      makeCandidate({ topic: 'learning goal', confidence: 0.75 }),
    ];

    await useCase.schedule({ ...baseInput, candidates });

    expect(repo.save).toHaveBeenCalledTimes(2);
    expect(outbox.enqueueFollowUpExecution).toHaveBeenCalledTimes(2);
  });

  it('handles empty candidates list gracefully', async () => {
    const repo = makeActionRepo();
    const outbox = makeOutbox();
    const useCase = new FollowUpSchedulerUseCase(repo, outbox);

    await useCase.schedule({ ...baseInput, candidates: [] });

    expect(repo.save).not.toHaveBeenCalled();
  });
});
