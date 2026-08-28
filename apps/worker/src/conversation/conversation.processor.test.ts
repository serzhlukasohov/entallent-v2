import { describe, expect, it, vi } from 'vitest';
import type { Job } from 'bullmq';
import {
  ConversationProcessor,
  resolveEffectiveLocale,
  type CheckInJob,
  type ConversationJob,
} from './conversation.processor';

const jobData: ConversationJob = {
  requestId: 'request-1',
  eventId: 'd5be8400-e29b-41d4-a716-446655440000',
  messageId: 'message-1',
  conversationId: 'conversation-1',
  userId: 'user-1',
  tenantId: 'tenant-1',
  externalWorkspaceId: 'workspace-1',
  externalConversationId: 'channel-1',
  traceId: 'trace-1',
};

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

describe('resolveEffectiveLocale', () => {
  it('prefers recent Cyrillic user language over the stored locale', () => {
    expect(
      resolveEffectiveLocale('en', [
        {
          role: 'user',
          content: 'сегодня нужно быть максимально продуктивной и закрыть отчеты',
          timestamp: '2026-08-14T09:00:00.000Z',
        },
      ]),
    ).toBe('ru');
  });

  it('prefers recent Ukrainian user language over the stored locale', () => {
    expect(
      resolveEffectiveLocale('en', [
        {
          role: 'user',
          content: 'я думаю що давати напрямок моя найсильніша сторона',
          timestamp: '2026-08-14T09:00:00.000Z',
        },
      ]),
    ).toBe('uk');
  });

  it('keeps the stored locale when recent user language is not clearly Cyrillic', () => {
    expect(
      resolveEffectiveLocale('en', [
        {
          role: 'user',
          content: 'everything is clear',
          timestamp: '2026-08-14T09:00:00.000Z',
        },
      ]),
    ).toBe('en');
  });

  it('keeps the stored locale for too-short text', () => {
    expect(
      resolveEffectiveLocale('en', [
        {
          role: 'user',
          content: 'ok',
          timestamp: '2026-08-14T09:00:00.000Z',
        },
      ]),
    ).toBe('en');
  });
});

function createProcessor(options: {
  agentRuntime?: { processMessage: ReturnType<typeof vi.fn> };
  orchestrator?: { orchestrate: ReturnType<typeof vi.fn> };
  checkInUseCase?: { execute: ReturnType<typeof vi.fn> };
  pulseBacklogService?: {
    getNextProbeQuestion: ReturnType<typeof vi.fn>;
    recordProbeSent: ReturnType<typeof vi.fn>;
  };
  runtimeControls?: {
    isEnabled: ReturnType<typeof vi.fn>;
    isUserDenylisted: ReturnType<typeof vi.fn>;
  };
  featureFlags?: { isEnabled: ReturnType<typeof vi.fn> };
  llmRunRepo?: { record: ReturnType<typeof vi.fn> };
  db?: unknown;
} = {}) {
  const agentRuntime = options.agentRuntime ?? {
    processMessage: vi.fn(async () => runtimeResult),
  };
  const orchestrator = options.orchestrator ?? {
    orchestrate: vi.fn(async () => runtimeResult),
  };
  const checkInUseCase = options.checkInUseCase ?? {
    execute: vi.fn(async () => ({
      outboundMessageId: 'check-in-outbound-1',
      responseText: 'legacy check-in',
      probeQuestionId: null,
    })),
  };
  const pulseBacklogService = options.pulseBacklogService ?? {
    getNextProbeQuestion: vi.fn(async () => null),
    recordProbeSent: vi.fn(async () => undefined),
  };
  const runtimeControls = options.runtimeControls ?? {
    isEnabled: vi.fn(async (key: string) => key === 'maf_runtime_primary'),
    isUserDenylisted: vi.fn(async () => false),
  };
  const featureFlags = options.featureFlags ?? {
    isEnabled: vi.fn(async () => true),
  };
  const llmRunRepo = options.llmRunRepo ?? {
    record: vi.fn(async () => undefined),
  };

  return {
    processor: new ConversationProcessor(
      agentRuntime as never,
      orchestrator as never,
      checkInUseCase as never,
      pulseBacklogService as never,
      runtimeControls as never,
      featureFlags as never,
      llmRunRepo as never,
      (options.db ?? {}) as never,
    ),
    agentRuntime,
    orchestrator,
    checkInUseCase,
    pulseBacklogService,
    runtimeControls,
    featureFlags,
    llmRunRepo,
  };
}

describe('ConversationProcessor routing', () => {
  it('routes inbound jobs directly through the existing orchestrator without MAF preloading', async () => {
    const orchestrator = {
      orchestrate: vi.fn(async () => runtimeResult),
    };
    const agentRuntime = {
      processMessage: vi.fn(async () => runtimeResult),
    };
    const select = vi.fn();
    const llmRunRepo = {
      record: vi.fn(async () => undefined),
    };
    const { processor } = createProcessor({
      orchestrator,
      agentRuntime,
      llmRunRepo,
      db: { client: { select } },
    });

    await processor.process({
      id: 'job-1',
      name: 'process',
      attemptsMade: 0,
      data: jobData,
    } as Job<ConversationJob>);

    expect(orchestrator.orchestrate).toHaveBeenCalledOnce();
    expect(orchestrator.orchestrate).toHaveBeenCalledWith(jobData);
    expect(agentRuntime.processMessage).not.toHaveBeenCalled();
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

  it('propagates orchestrator failures and records the inbound run as failed', async () => {
    const orchestrator = {
      orchestrate: vi.fn(async () => {
        throw new Error('orchestrator failed');
      }),
    };
    const agentRuntime = {
      processMessage: vi.fn(async () => runtimeResult),
    };
    const llmRunRepo = {
      record: vi.fn(async () => undefined),
    };
    const { processor } = createProcessor({ orchestrator, agentRuntime, llmRunRepo });

    await expect(processor.process({
      id: 'job-1',
      name: 'process',
      attemptsMade: 0,
      data: jobData,
    } as Job<ConversationJob>)).rejects.toThrow('orchestrator failed');

    expect(agentRuntime.processMessage).not.toHaveBeenCalled();
    expect(llmRunRepo.record).toHaveBeenCalledWith(expect.objectContaining({
      status: 'error',
      traceId: 'trace-1',
    }));
  });

  it('Proactive check-ins maf_primary regression routes selected probe metadata despite stored English locale', async () => {
    const checkInJobData: CheckInJob = {
      conversationId: '44444444-4444-4444-8444-444444444444',
      userId: '55555555-5555-4555-8555-555555555555',
      tenantId: '66666666-6666-4666-8666-666666666666',
      externalWorkspaceId: 'workspace-1',
      externalConversationId: 'channel-1',
      traceId: 'trace-check-in-1',
    };
    const tenantQuery = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn(async () => [{ policy: {} }]),
    };
    const conversationQuery = {
      from: vi.fn().mockReturnThis(),
      leftJoin: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn(async () => [{
        userPreferredName: 'Test User',
        userTimezone: 'Europe/Warsaw',
        userLocale: 'en-US',
      }]),
    };
    const recentQuery = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn(async () => [
        {
          text: 'Я пытаюсь понять, что именно будет считаться успехом для онбординга на этой неделе.',
          senderType: 'user',
          direction: 'inbound',
          occurredAt: new Date('2026-08-11T08:00:00.000Z'),
        },
        {
          text: 'На прошлой неделе ты говорил, что rollout застрял из-за неясной ответственности.',
          senderType: 'agent',
          direction: 'outbound',
          occurredAt: new Date('2026-08-11T07:55:00.000Z'),
        },
      ]),
    };
    const memoryQuery = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn(async () => [
        {
          id: 'memory-onboarding-rollout',
          tenantId: '66666666-6666-4666-8666-666666666666',
          userId: '55555555-5555-4555-8555-555555555555',
          category: 'project_context',
          content: 'User is leading the onboarding rollout and cares about clear ownership.',
          importance: '0.92',
          status: 'active',
          expiresAt: null,
          supersededById: null,
          createdAt: new Date('2026-08-11T07:50:00.000Z'),
        },
        {
          id: 'memory-prefers-concise-checkins',
          tenantId: '66666666-6666-4666-8666-666666666666',
          userId: '55555555-5555-4555-8555-555555555555',
          category: 'communication_preference',
          content: 'User prefers concise check-ins with one concrete question.',
          importance: '0.84',
          status: 'active',
          expiresAt: null,
          supersededById: null,
          createdAt: new Date('2026-08-11T07:45:00.000Z'),
        },
      ]),
    };
    const insertValues = vi.fn(async () => undefined);
    const db = {
      client: {
        select: vi.fn()
          .mockReturnValueOnce(tenantQuery)
          .mockReturnValueOnce(conversationQuery)
          .mockReturnValueOnce(recentQuery)
          .mockReturnValueOnce(memoryQuery),
        insert: vi.fn(() => ({ values: insertValues })),
      },
    };
    const pulseBacklogService = {
      getNextProbeQuestion: vi.fn(async () => ({
        windowId: 'window-1',
        question: {
          id: '88888888-8888-4888-8888-888888888888',
          stableKey: 'role_clarity',
          title: 'Role Clarity',
          questionGroup: 'growth',
          responseType: 'numeric_0_10',
          probeStrategies: ['Ask what success looks like this week.'],
        },
      })),
      recordProbeSent: vi.fn(async () => undefined),
    };
    const agentRuntime = {
      processMessage: vi.fn(async () => ({
        ...runtimeResult,
        replyMetadata: {
          containsSurveyProbe: true,
          surveyProbeQuestionId: '88888888-8888-4888-8888-888888888888',
        },
      })),
    };
    const { processor, checkInUseCase } = createProcessor({
      agentRuntime,
      pulseBacklogService,
      db,
    });

    await processor.process({
      id: 'check-in-job-1',
      name: 'check-in',
      attemptsMade: 0,
      data: checkInJobData,
    } as Job<CheckInJob>);

    expect(checkInUseCase.execute).not.toHaveBeenCalled();
    expect(insertValues).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: '66666666-6666-4666-8666-666666666666',
      conversationId: '44444444-4444-4444-8444-444444444444',
      userId: '55555555-5555-4555-8555-555555555555',
      direction: 'inbound',
      senderType: 'system',
      text: 'Start a proactive pulse check-in about Role Clarity.',
      messageType: 'proactive_check_in_request',
      traceId: 'trace-check-in-1',
      metadata: {
        runtimePurpose: 'proactive_check_in',
        synthetic: true,
        hiddenFromConversationContext: true,
        userLocale: 'ru',
        surveyProbeQuestionId: '88888888-8888-4888-8888-888888888888',
        surveyProbeStableKey: 'role_clarity',
        surveyProbeTitle: 'Role Clarity',
        surveyProbeQuestionGroup: 'growth',
      },
    }));
    expect(agentRuntime.processMessage).toHaveBeenCalledWith(expect.objectContaining({
      requestPurpose: 'proactive_check_in',
      externalWorkspaceId: 'workspace-1',
      externalConversationId: 'channel-1',
      conversationId: '44444444-4444-4444-8444-444444444444',
      userId: '55555555-5555-4555-8555-555555555555',
      runtimeAttempt: 1,
      traceId: 'trace-check-in-1',
      messageText: 'Start a proactive pulse check-in about Role Clarity.',
      userDisplayName: 'Test User',
      userTimezone: 'Europe/Warsaw',
      userLocale: 'ru',
      conversationSessionKey:
        'workspace-1:55555555-5555-4555-8555-555555555555:channel-1:dm',
      proactiveContext: {
        reason: 'pulse_check_in',
        probeQuestion: {
          id: '88888888-8888-4888-8888-888888888888',
          stableKey: 'role_clarity',
          title: 'Role Clarity',
          group: 'growth',
          responseType: 'numeric_0_10',
          probeStrategies: ['Ask what success looks like this week.'],
        },
      },
      runtimeContext: expect.objectContaining({
        recentTurns: [
          {
            role: 'assistant',
            content: 'На прошлой неделе ты говорил, что rollout застрял из-за неясной ответственности.',
            timestamp: '2026-08-11T07:55:00.000Z',
          },
          {
            role: 'user',
            content: 'Я пытаюсь понять, что именно будет считаться успехом для онбординга на этой неделе.',
            timestamp: '2026-08-11T08:00:00.000Z',
          },
        ],
        memoryItems: [
          {
            id: 'memory-onboarding-rollout',
            category: 'project_context',
            content: 'User is leading the onboarding rollout and cares about clear ownership.',
            importance: 0.92,
          },
          {
            id: 'memory-prefers-concise-checkins',
            category: 'communication_preference',
            content: 'User prefers concise check-ins with one concrete question.',
            importance: 0.84,
          },
        ],
        goals: [],
        replyPolicy: {
          maxChars: 360,
          maxQuestions: 1,
          allowReflectiveOpener: false,
          allowListFormatting: false,
        },
      }),
    }));
    expect(pulseBacklogService.recordProbeSent).toHaveBeenCalledWith(
      '55555555-5555-4555-8555-555555555555',
      'window-1',
      '88888888-8888-4888-8888-888888888888',
      expect.any(Date),
    );
  });

  it('continues proactive MAF check-in without a probe when optional pulse backlog lookup fails', async () => {
    const checkInJobData: CheckInJob = {
      conversationId: '44444444-4444-4444-8444-444444444444',
      userId: '55555555-5555-4555-8555-555555555555',
      tenantId: '66666666-6666-4666-8666-666666666666',
      externalWorkspaceId: 'workspace-1',
      externalConversationId: 'channel-1',
      traceId: 'trace-check-in-1',
    };
    const tenantQuery = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn(async () => [{ policy: {} }]),
    };
    const conversationQuery = {
      from: vi.fn().mockReturnThis(),
      leftJoin: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn(async () => [{
        userPreferredName: 'Test User',
        userTimezone: 'Europe/Warsaw',
        userLocale: 'en-US',
      }]),
    };
    const recentQuery = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn(async () => []),
    };
    const memoryQuery = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn(async () => []),
    };
    const db = {
      client: {
        select: vi.fn()
          .mockReturnValueOnce(tenantQuery)
          .mockReturnValueOnce(conversationQuery)
          .mockReturnValueOnce(recentQuery)
          .mockReturnValueOnce(memoryQuery),
        insert: vi.fn(() => ({ values: vi.fn(async () => undefined) })),
      },
    };
    const pulseBacklogService = {
      getNextProbeQuestion: vi.fn(async () => {
        throw new Error('survey window unavailable');
      }),
      recordProbeSent: vi.fn(async () => undefined),
    };
    const agentRuntime = {
      processMessage: vi.fn(async () => runtimeResult),
    };
    const { processor, checkInUseCase } = createProcessor({
      agentRuntime,
      pulseBacklogService,
      db,
    });

    await processor.process({
      id: 'check-in-job-1',
      name: 'check-in',
      attemptsMade: 0,
      data: checkInJobData,
    } as Job<CheckInJob>);

    expect(checkInUseCase.execute).not.toHaveBeenCalled();
    expect(agentRuntime.processMessage).toHaveBeenCalledWith(expect.objectContaining({
      requestPurpose: 'proactive_check_in',
      messageText: 'Start a proactive pulse check-in.',
      proactiveContext: {
        reason: 'pulse_check_in',
      },
    }));
    expect(pulseBacklogService.recordProbeSent).not.toHaveBeenCalled();
  });

  it('fails MAF check-in before recent-turn context when the conversation does not belong to the job user', async () => {
    const checkInJobData: CheckInJob = {
      conversationId: '44444444-4444-4444-8444-444444444444',
      userId: '55555555-5555-4555-8555-555555555555',
      tenantId: '66666666-6666-4666-8666-666666666666',
      externalWorkspaceId: 'workspace-1',
      externalConversationId: 'channel-1',
      traceId: 'trace-check-in-1',
    };
    const tenantQuery = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn(async () => [{ policy: {} }]),
    };
    const conversationQuery = {
      from: vi.fn().mockReturnThis(),
      leftJoin: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn(async () => []),
    };
    const db = {
      client: {
        select: vi.fn()
          .mockReturnValueOnce(tenantQuery)
          .mockReturnValueOnce(conversationQuery),
        insert: vi.fn(() => ({ values: vi.fn(async () => undefined) })),
      },
    };
    const agentRuntime = {
      processMessage: vi.fn(async () => runtimeResult),
    };
    const { processor, checkInUseCase } = createProcessor({ agentRuntime, db });

    await expect(processor.process({
      id: 'check-in-job-1',
      name: 'check-in',
      attemptsMade: 0,
      data: checkInJobData,
    } as Job<CheckInJob>)).rejects.toThrow(
      'Conversation 44444444-4444-4444-8444-444444444444 not found for check-in user 55555555-5555-4555-8555-555555555555',
    );

    expect(agentRuntime.processMessage).not.toHaveBeenCalled();
    expect(checkInUseCase.execute).not.toHaveBeenCalled();
  });

  it('does not retry a committed MAF check-in reply when probe-sent recording fails', async () => {
    const checkInJobData: CheckInJob = {
      conversationId: '44444444-4444-4444-8444-444444444444',
      userId: '55555555-5555-4555-8555-555555555555',
      tenantId: '66666666-6666-4666-8666-666666666666',
      externalWorkspaceId: 'workspace-1',
      externalConversationId: 'channel-1',
      traceId: 'trace-check-in-1',
    };
    const tenantQuery = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn(async () => [{ policy: {} }]),
    };
    const conversationQuery = {
      from: vi.fn().mockReturnThis(),
      leftJoin: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn(async () => [{
        userPreferredName: 'Test User',
        userTimezone: 'Europe/Warsaw',
        userLocale: 'en-US',
      }]),
    };
    const recentQuery = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn(async () => []),
    };
    const memoryQuery = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn(async () => []),
    };
    const db = {
      client: {
        select: vi.fn()
          .mockReturnValueOnce(tenantQuery)
          .mockReturnValueOnce(conversationQuery)
          .mockReturnValueOnce(recentQuery)
          .mockReturnValueOnce(memoryQuery),
        insert: vi.fn(() => ({ values: vi.fn(async () => undefined) })),
      },
    };
    const pulseBacklogService = {
      getNextProbeQuestion: vi.fn(async () => ({
        windowId: 'window-1',
        question: {
          id: '88888888-8888-4888-8888-888888888888',
          stableKey: 'role_clarity',
          title: 'Role Clarity',
          questionGroup: 'growth',
          probeStrategies: ['Ask what success looks like this week.'],
        },
      })),
      recordProbeSent: vi.fn(async () => {
        throw new Error('database temporarily unavailable');
      }),
    };
    const agentRuntime = {
      processMessage: vi.fn(async () => ({
        ...runtimeResult,
        replyMetadata: {
          containsSurveyProbe: true,
          surveyProbeQuestionId: '88888888-8888-4888-8888-888888888888',
        },
      })),
    };
    const { processor } = createProcessor({ agentRuntime, pulseBacklogService, db });

    await expect(processor.process({
      id: 'check-in-job-1',
      name: 'check-in',
      attemptsMade: 0,
      data: checkInJobData,
    } as Job<CheckInJob>)).resolves.toBeUndefined();

    expect(agentRuntime.processMessage).toHaveBeenCalled();
    expect(pulseBacklogService.recordProbeSent).toHaveBeenCalled();
  });

  it('keeps legacy proactive check-in path when MAF primary is disabled', async () => {
    const tenantQuery = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn(async () => [{ policy: {} }]),
    };
    const db = {
      client: {
        select: vi.fn().mockReturnValueOnce(tenantQuery),
      },
    };
    const runtimeControls = {
      isEnabled: vi.fn(async () => false),
      isUserDenylisted: vi.fn(async () => false),
    };
    const agentRuntime = {
      processMessage: vi.fn(async () => runtimeResult),
    };
    const checkInUseCase = {
      execute: vi.fn(async () => ({
        outboundMessageId: 'legacy-outbound-1',
        responseText: 'legacy check-in',
        probeQuestionId: null,
      })),
    };
    const { processor } = createProcessor({
      agentRuntime,
      checkInUseCase,
      runtimeControls,
      db,
    });

    await processor.process({
      id: 'check-in-job-1',
      name: 'check-in',
      attemptsMade: 0,
      data: {
        conversationId: 'conversation-1',
        userId: 'user-1',
        tenantId: 'tenant-1',
        externalWorkspaceId: 'workspace-1',
        externalConversationId: 'channel-1',
        traceId: 'trace-check-in-1',
      },
    } as Job<CheckInJob>);

    expect(agentRuntime.processMessage).not.toHaveBeenCalled();
    expect(checkInUseCase.execute).toHaveBeenCalled();
  });
});
