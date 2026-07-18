import { describe, it, expect, vi } from 'vitest';
import { FollowUpExecutionUseCase } from './follow-up-execution.use-case';
import type { ScheduledActionRepositoryPort } from '../ports/scheduled-action.repository.port';
import type { FollowUpContextPort, FollowUpContextData } from '../ports/follow-up-context.port';
import type { ConversationRepositoryPort } from '../ports/conversation.repository.port';
import type { OutboxPort } from '../ports/outbox.port';
import type { AiProviderPort } from '../ports/ai-provider.port';
import type { ScheduledActionRecord } from '../types/records';

const ACTION_CONTEXT = {
  channelType: 'slack',
  externalConversationId: 'ext-c-1',
  messageStrategy: 'light_check_in',
  topic: 'project progress',
  originalReason: 'user started a big project',
};

function makeAction(overrides: Partial<ScheduledActionRecord> = {}): ScheduledActionRecord {
  return {
    id: 'action-1',
    tenantId: 't-1',
    userId: 'u-1',
    conversationId: 'c-1',
    type: 'follow_up',
    intent: 'check on project progress',
    context: ACTION_CONTEXT,
    dueAt: new Date(Date.now() - 1000), // already due
    timezone: 'UTC',
    status: 'pending',
    cancellationConditions: [],
    attemptCount: 0,
    maxAttempts: 3,
    sourceMessageIds: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    deduplicationKey: 'u-1:follow_up:project',
    ...overrides,
  };
}

function makeContext(overrides: Partial<FollowUpContextData> = {}): FollowUpContextData {
  return {
    user: {
      proactiveMessagingEnabled: true,
      timezone: 'UTC',
      quietHours: { enabled: false },
      preferredName: 'Alice',
    },
    conversation: { id: 'c-1', tenantId: 't-1', userId: 'u-1', channelType: 'slack', externalConversationId: 'ext-c-1', status: 'active' },
    workspaceConnection: { id: 'wc-1', tenantId: 't-1', externalWorkspaceId: 'ws-1', channelType: 'slack', botToken: 'tok', signingSecret: 'sec' },
    lastInboundAt: null,
    recentProactiveCount24h: 0,
    recentProactiveCount7d: 0,
    hasActiveHighRisk: false,
    ...overrides,
  };
}

function makeRepo(action: ScheduledActionRecord | null): ScheduledActionRepositoryPort {
  return {
    findById: vi.fn().mockResolvedValue(action),
    cancel: vi.fn().mockResolvedValue(undefined),
    markSent: vi.fn().mockResolvedValue(undefined),
    reschedule: vi.fn().mockResolvedValue(undefined),
    postpone: vi.fn().mockResolvedValue(undefined),
    save: vi.fn(),
    existsByDeduplicationKey: vi.fn(),
  } as unknown as ScheduledActionRepositoryPort;
}

function makeContextPort(ctx: FollowUpContextData): FollowUpContextPort {
  return { load: vi.fn().mockResolvedValue(ctx) };
}

function makeConversationRepo(): ConversationRepositoryPort {
  return {
    findRecentMessages: vi.fn().mockResolvedValue([]),
    findById: vi.fn(),
    saveMessage: vi.fn().mockResolvedValue({ id: 'msg-out', direction: 'outbound', text: 'Hi Alice!', tenantId: 't-1', conversationId: 'c-1', userId: 'u-1', occurredAt: new Date(), createdAt: new Date() }),
  } as unknown as ConversationRepositoryPort;
}

function makeAi(): AiProviderPort {
  return {
    classifySituation: vi.fn(),
    detectRisk: vi.fn(),
    extractMemory: vi.fn(),
    evaluateSurveyEvidence: vi.fn(),
    generateResponse: vi.fn().mockResolvedValue({ text: 'Hey Alice, how is the project going?', followUpQuestion: null }),
  };
}

function makeOutbox(): OutboxPort {
  return {
    enqueueMessageSend: vi.fn().mockResolvedValue(undefined),
    enqueueMemoryExtraction: vi.fn(),
    enqueueFollowUpExecution: vi.fn(),
    enqueueSurveyEvidence: vi.fn(),
  };
}

const baseInput = { scheduledActionId: 'action-1', tenantId: 't-1', userId: 'u-1' };

describe('FollowUpExecutionUseCase — policy decisions', () => {
  it('returns skip when action is not found', async () => {
    const uc = new FollowUpExecutionUseCase(makeRepo(null), makeContextPort(makeContext()), makeConversationRepo(), makeOutbox(), makeAi());
    const result = await uc.execute(baseInput);
    expect(result.decision).toBe('skip');
  });

  it('returns skip when action is already sent', async () => {
    const uc = new FollowUpExecutionUseCase(makeRepo(makeAction({ status: 'sent' })), makeContextPort(makeContext()), makeConversationRepo(), makeOutbox(), makeAi());
    const result = await uc.execute(baseInput);
    expect(result.decision).toBe('skip');
    expect(result.reason).toBe('not_pending');
  });

  it('returns cancel when max attempts exceeded', async () => {
    const repo = makeRepo(makeAction({ attemptCount: 3, maxAttempts: 3 }));
    const uc = new FollowUpExecutionUseCase(repo, makeContextPort(makeContext()), makeConversationRepo(), makeOutbox(), makeAi());
    const result = await uc.execute(baseInput);
    expect(result.decision).toBe('cancel');
    expect(result.reason).toBe('max_attempts_exceeded');
    expect(repo.cancel).toHaveBeenCalled();
  });

  it('returns cancel when proactive messaging is disabled for user', async () => {
    const ctx = makeContext({ user: { ...makeContext().user, proactiveMessagingEnabled: false } });
    const repo = makeRepo(makeAction());
    const uc = new FollowUpExecutionUseCase(repo, makeContextPort(ctx), makeConversationRepo(), makeOutbox(), makeAi());
    const result = await uc.execute(baseInput);
    expect(result.decision).toBe('cancel');
    expect(result.reason).toBe('proactive_disabled');
    expect(repo.cancel).toHaveBeenCalled();
  });

  it('returns postpone when quiet hours are active', async () => {
    const now = new Date();
    const startHour = now.getUTCHours();
    const endHour = (now.getUTCHours() + 2) % 24;
    const ctx = makeContext({
      user: { ...makeContext().user, quietHours: { enabled: true, startHour, endHour }, timezone: 'UTC' },
    });
    const repo = makeRepo(makeAction());
    const uc = new FollowUpExecutionUseCase(repo, makeContextPort(ctx), makeConversationRepo(), makeOutbox(), makeAi());
    const result = await uc.execute(baseInput);
    expect(result.decision).toBe('postpone');
    expect(result.reason).toBe('quiet_hours');
  });

  it('returns postpone when daily proactive limit is reached', async () => {
    const ctx = makeContext({ recentProactiveCount24h: 1 }); // >= DAILY_PROACTIVE_LIMIT (1)
    const repo = makeRepo(makeAction());
    const uc = new FollowUpExecutionUseCase(repo, makeContextPort(ctx), makeConversationRepo(), makeOutbox(), makeAi());
    const result = await uc.execute(baseInput);
    expect(result.decision).toBe('postpone');
    expect(result.reason).toBe('daily_limit_reached');
  });

  it('returns postpone when user has active high-risk signal', async () => {
    const ctx = makeContext({ hasActiveHighRisk: true });
    const repo = makeRepo(makeAction());
    const uc = new FollowUpExecutionUseCase(repo, makeContextPort(ctx), makeConversationRepo(), makeOutbox(), makeAi());
    const result = await uc.execute(baseInput);
    expect(result.decision).toBe('postpone');
    expect(result.reason).toBe('active_risk_signal');
  });

  it('returns postpone when there is recent inbound activity (within 2 hours)', async () => {
    const ctx = makeContext({ lastInboundAt: new Date(Date.now() - 30 * 60 * 1000) }); // 30 min ago
    const repo = makeRepo(makeAction());
    const uc = new FollowUpExecutionUseCase(repo, makeContextPort(ctx), makeConversationRepo(), makeOutbox(), makeAi());
    const result = await uc.execute(baseInput);
    expect(result.decision).toBe('postpone');
    expect(result.reason).toBe('recent_inbound_activity');
  });

  it('returns cancel when channel context is missing', async () => {
    const ctx = makeContext({ conversation: null, workspaceConnection: null });
    const repo = makeRepo(makeAction());
    const uc = new FollowUpExecutionUseCase(repo, makeContextPort(ctx), makeConversationRepo(), makeOutbox(), makeAi());
    const result = await uc.execute(baseInput);
    expect(result.decision).toBe('cancel');
    expect(result.reason).toBe('missing_channel_context');
  });

  it('returns send and calls AI + outbox when all checks pass', async () => {
    const ai = makeAi();
    const outbox = makeOutbox();
    const repo = makeRepo(makeAction());
    const uc = new FollowUpExecutionUseCase(repo, makeContextPort(makeContext()), makeConversationRepo(), outbox, ai);
    const result = await uc.execute(baseInput);
    expect(result.decision).toBe('send');
    expect(ai.generateResponse).toHaveBeenCalled();
    expect(outbox.enqueueMessageSend).toHaveBeenCalled();
    expect(repo.markSent).toHaveBeenCalled();
  });
});
