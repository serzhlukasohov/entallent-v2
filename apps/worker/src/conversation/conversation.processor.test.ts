import type { Job } from 'bullmq';
import { describe, expect, it, vi } from 'vitest';
import {
  ConversationProcessor,
  type CheckInJob,
  type ConversationJob,
} from './conversation.processor';

const runtimeResult = {
  outboundMessageId: 'outbound-1',
  responseText: 'reply',
  mode: 'normal',
  classification: {
    primaryIntent: 'casual_conversation',
    secondaryIntents: [],
    emotionalState: [],
    urgency: 'low',
    confidence: 0.9,
    requiresSafetyCheck: false,
    surveyAllowed: true,
    reasoningSummary: 'test',
    reminderRequest: null,
    dialogueAct: 'new_substance',
    latestUserSubstance: 'hello',
    topicAnchor: null,
  },
  risk: {
    riskType: null,
    severity: 'none',
    confidence: 0,
    evidence: [],
    immediateResponseRequired: false,
    escalationRecommended: false,
    surveyMustBeBlocked: false,
    proactiveMessagesMustBePaused: false,
    reasoningSummary: 'none',
  },
};

const conversationJob: ConversationJob = {
  requestId: 'request-1',
  eventId: 'event-1',
  messageId: 'message-1',
  conversationId: 'conversation-1',
  userId: 'user-1',
  tenantId: 'tenant-1',
  externalWorkspaceId: 'workspace-1',
  externalConversationId: 'channel-1',
  traceId: 'trace-1',
  rapidMessageCoalescing: true,
};

const checkInJob: CheckInJob = {
  conversationId: 'conversation-1',
  userId: 'user-1',
  tenantId: 'tenant-1',
  externalWorkspaceId: 'workspace-1',
  externalConversationId: 'channel-1',
  traceId: 'trace-check-in-1',
};

function tenantQuery(policy: Record<string, unknown> = {}) {
  return {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn(async () => [{ policy }]),
  };
}

function createProcessor(options: {
  orchestrator?: { orchestrate: ReturnType<typeof vi.fn> };
  checkInUseCase?: { execute: ReturnType<typeof vi.fn> };
  llmRunRepo?: { record: ReturnType<typeof vi.fn> };
  conversationRepo?: { shouldSkipInboundMessage: ReturnType<typeof vi.fn> };
  db?: unknown;
} = {}) {
  const orchestrator = options.orchestrator ?? {
    orchestrate: vi.fn(async () => runtimeResult),
  };
  const checkInUseCase = options.checkInUseCase ?? {
    execute: vi.fn(async () => ({
      outboundMessageId: 'check-in-outbound-1',
      responseText: 'TypeScript check-in',
      probeQuestionId: null,
    })),
  };
  const llmRunRepo = options.llmRunRepo ?? {
    record: vi.fn(async () => undefined),
  };
  const conversationRepo = options.conversationRepo ?? {
    shouldSkipInboundMessage: vi.fn(async () => false),
  };
  const select = vi.fn(() => tenantQuery());
  const db = options.db ?? { client: { select } };

  return {
    processor: new ConversationProcessor(
      orchestrator as never,
      checkInUseCase as never,
      llmRunRepo as never,
      db as never,
      conversationRepo as never,
    ),
    orchestrator,
    checkInUseCase,
    llmRunRepo,
    conversationRepo,
    select,
  };
}

describe('ConversationProcessor TypeScript-only routing', () => {
  it('routes inbound jobs directly through the TypeScript orchestrator', async () => {
    const { processor, orchestrator, llmRunRepo, conversationRepo, select } = createProcessor();

    await processor.process({
      id: 'job-1',
      name: 'process',
      attemptsMade: 0,
      opts: { delay: 2_000 },
      data: conversationJob,
    } as Job<ConversationJob>);

    expect(orchestrator.orchestrate).toHaveBeenCalledOnce();
    expect(orchestrator.orchestrate).toHaveBeenCalledWith(conversationJob);
    expect(conversationRepo.shouldSkipInboundMessage).toHaveBeenCalledWith({
      messageId: 'message-1',
      conversationId: 'conversation-1',
      userId: 'user-1',
      tenantId: 'tenant-1',
      windowMs: 2_000,
    });
    expect(select).not.toHaveBeenCalled();
    expect(llmRunRepo.record).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      userId: 'user-1',
      taskType: 'conversation',
      model: 'gpt-4o',
      latencyMs: expect.any(Number),
      status: 'success',
      traceId: 'trace-1',
    });
  });

  it('no-ops stale original and retry jobs before orchestration and LLM accounting', async () => {
    const conversationRepo = {
      shouldSkipInboundMessage: vi.fn()
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false),
    };
    const { processor, orchestrator, llmRunRepo } = createProcessor({ conversationRepo });
    const stale = {
      id: 'job-1',
      name: 'process',
      opts: { delay: 2_000 },
      data: conversationJob,
    } as Job<ConversationJob>;
    const tailJob = {
      id: 'job-2',
      name: 'process',
      attemptsMade: 0,
      opts: { delay: 2_000 },
      data: {
        ...conversationJob,
        eventId: 'event-2',
        messageId: 'message-2',
        traceId: 'trace-2',
      },
    } as Job<ConversationJob>;

    await processor.process({ ...stale, attemptsMade: 0 } as Job<ConversationJob>);
    await processor.process({ ...stale, attemptsMade: 1 } as Job<ConversationJob>);
    await processor.process({ ...stale, attemptsMade: 0, opts: {} } as Job<ConversationJob>);
    await processor.process(tailJob);

    expect(conversationRepo.shouldSkipInboundMessage).toHaveBeenCalledTimes(4);
    expect(orchestrator.orchestrate).toHaveBeenCalledOnce();
    expect(orchestrator.orchestrate).toHaveBeenCalledWith(tailJob.data);
    expect(llmRunRepo.record).toHaveBeenCalledOnce();
    expect(llmRunRepo.record).toHaveBeenCalledWith(expect.objectContaining({ traceId: 'trace-2' }));
  });

  it('does not coalesce unmarked non-Slack conversation jobs', async () => {
    const { processor, orchestrator, conversationRepo } = createProcessor();
    const data = { ...conversationJob, rapidMessageCoalescing: undefined };

    await processor.process({
      id: 'job-dev-1',
      name: 'process',
      attemptsMade: 0,
      opts: { delay: 2_000 },
      data,
    } as Job<ConversationJob>);

    expect(conversationRepo.shouldSkipInboundMessage).not.toHaveBeenCalled();
    expect(orchestrator.orchestrate).toHaveBeenCalledWith(data);
  });

  it('routes every proactive check-in through ProactiveCheckInUseCase', async () => {
    const query = tenantQuery({ ignoreWindowHours: 24 });
    const checkInUseCase = {
      execute: vi.fn(async () => ({
        outboundMessageId: 'check-in-outbound-1',
        responseText: 'TypeScript check-in',
        probeQuestionId: 'probe-1',
      })),
    };
    const { processor } = createProcessor({
      checkInUseCase,
      db: { client: { select: vi.fn(() => query) } },
    });

    await processor.process({
      id: 'check-in-job-1',
      name: 'check-in',
      attemptsMade: 0,
      data: checkInJob,
    } as Job<CheckInJob>);

    expect(checkInUseCase.execute).toHaveBeenCalledOnce();
    expect(checkInUseCase.execute).toHaveBeenCalledWith({
      ...checkInJob,
      pulseConfig: { ignoreWindowHours: 24 },
    });
  });

  it('propagates orchestrator failures and records the inbound run as failed', async () => {
    const orchestrator = {
      orchestrate: vi.fn(async () => {
        throw new Error('orchestrator failed');
      }),
    };
    const llmRunRepo = {
      record: vi.fn(async () => undefined),
    };
    const { processor } = createProcessor({ orchestrator, llmRunRepo });

    await expect(processor.process({
      id: 'job-1',
      name: 'process',
      attemptsMade: 0,
      opts: { delay: 2_000 },
      data: conversationJob,
    } as Job<ConversationJob>)).rejects.toThrow('orchestrator failed');

    expect(llmRunRepo.record).toHaveBeenCalledWith(expect.objectContaining({
      status: 'error',
      traceId: 'trace-1',
    }));
  });
});
