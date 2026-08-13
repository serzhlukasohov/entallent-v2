import { describe, expect, it, vi } from 'vitest';
import type { Job } from 'bullmq';
import { ConversationProcessor, type CheckInJob, type ConversationJob } from './conversation.processor';

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

function createProcessor(options: {
  agentRuntime?: { processMessage: ReturnType<typeof vi.fn> };
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
  ai?: { classifySituation: ReturnType<typeof vi.fn> };
  llmRunRepo?: { record: ReturnType<typeof vi.fn> };
  db?: unknown;
} = {}) {
  const agentRuntime = options.agentRuntime ?? {
    processMessage: vi.fn(async () => runtimeResult),
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
  const ai = options.ai ?? {
    classifySituation: vi.fn(async () => runtimeResult.classification),
  };
  const llmRunRepo = options.llmRunRepo ?? {
    record: vi.fn(async () => undefined),
  };

  return {
    processor: new ConversationProcessor(
      agentRuntime as never,
      checkInUseCase as never,
      pulseBacklogService as never,
      runtimeControls as never,
      featureFlags as never,
      ai as never,
      llmRunRepo as never,
      (options.db ?? {}) as never,
    ),
    agentRuntime,
    checkInUseCase,
    pulseBacklogService,
    runtimeControls,
    featureFlags,
    ai,
    llmRunRepo,
  };
}

describe('ConversationProcessor runtime ledger recording', () => {
  it('passes durable runtime attempt metadata to the agent runtime', async () => {
    const agentRuntime = {
      processMessage: vi.fn(async () => runtimeResult),
    };
    const llmRunRepo = {
      record: vi.fn(async () => undefined),
    };
    const { processor } = createProcessor({ agentRuntime, llmRunRepo });

    await processor.process({
      id: 'job-1',
      name: 'process',
      attemptsMade: 0,
      data: jobData,
    } as Job<ConversationJob>);

    expect(agentRuntime.processMessage).toHaveBeenCalledWith({
      requestId: 'request-1',
      eventId: 'd5be8400-e29b-41d4-a716-446655440000',
      runtimeAttempt: 1,
      messageId: 'message-1',
      conversationId: 'conversation-1',
      userId: 'user-1',
      tenantId: 'tenant-1',
      externalWorkspaceId: 'workspace-1',
      externalConversationId: 'channel-1',
      traceId: 'trace-1',
    });
  });

  it('falls back to requestId for MAF request eventId when eventId format is invalid', async () => {
    const invalidEventJob: ConversationJob = {
      ...jobData,
      eventId: 'dev:event-1',
      requestId: 'c5c6d84e-5f8c-4a2a-a4af-b8f8f7d7dc99',
    };
    const agentRuntime = {
      processMessage: vi.fn(async () => runtimeResult),
    };
    const llmRunRepo = {
      record: vi.fn(async () => undefined),
    };
    const { processor } = createProcessor({ agentRuntime, llmRunRepo });

    await processor.process({
      id: 'job-1',
      name: 'process',
      attemptsMade: 0,
      data: invalidEventJob,
    } as Job<ConversationJob>);

    expect(agentRuntime.processMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: 'c5c6d84e-5f8c-4a2a-a4af-b8f8f7d7dc99',
      }),
    );
  });

  it('enriches the runtime request with bounded MAF candidate context from tenant-scoped message rows', async () => {
    const agentRuntime = {
      processMessage: vi.fn(async () => runtimeResult),
    };
    const llmRunRepo = {
      record: vi.fn(async () => undefined),
    };
    const currentQuery = {
      from: vi.fn().mockReturnThis(),
      leftJoin: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn(async () => [
        {
          text: 'I feel stuck but I can keep going.\n*Sent using* <@U0BPHHA21GC>',
          occurredAt: new Date('2026-08-06T18:00:00.000Z'),
          externalThreadId: 'thread-1',
          userPreferredName: 'Test User',
          userTimezone: 'Europe/Warsaw',
          userLocale: 'en-US',
        },
      ]),
    };
    const recentQuery = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn(async () => [
        {
          text: 'I feel stuck but I can keep going.\n*Sent using* <@U0BPHHA21GC>',
          senderType: 'user',
          direction: 'inbound',
          occurredAt: new Date('2026-08-06T18:00:00.000Z'),
        },
        {
          text: 'Earlier reply',
          senderType: 'agent',
          direction: 'outbound',
          occurredAt: new Date('2026-08-06T17:55:00.000Z'),
        },
        {
          text: 'Malformed historical turn',
          senderType: 'user',
          direction: 'inbound',
          occurredAt: 'not-a-date',
        },
      ]),
    };
    const memoryQuery = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn(async () => [
        {
          id: 'memory-1',
          category: 'project_context',
          content: 'The project codename is Север-17.',
          importance: '0.80',
        },
      ]),
    };
    const db = {
      client: {
        select: vi.fn().mockReturnValueOnce(currentQuery).mockReturnValueOnce(recentQuery).mockReturnValueOnce(memoryQuery),
      },
    };
    const ai = {
      classifySituation: vi.fn(async () => ({
        ...runtimeResult.classification,
        dialogueAct: 'acknowledgement',
        latestUserSubstance: null,
        topicAnchor: 'I feel stuck but I can keep going.',
      })),
    };
    const { processor } = createProcessor({ agentRuntime, llmRunRepo, db, ai });

    await processor.process({
      id: 'job-1',
      name: 'process',
      attemptsMade: 0,
      data: jobData,
    } as Job<ConversationJob>);

    expect(agentRuntime.processMessage).toHaveBeenCalledWith(expect.objectContaining({
      messageText: 'I feel stuck but I can keep going.',
      messageCreatedAt: '2026-08-06T18:00:00.000Z',
      userDisplayName: 'Test User',
      userTimezone: 'Europe/Warsaw',
      userLocale: 'en-US',
      conversationThreadId: 'thread-1',
      conversationSessionKey: 'workspace-1:user-1:channel-1:thread-1',
      runtimeContext: {
        recentTurns: [
          {
            role: 'assistant',
            content: 'Earlier reply',
            timestamp: '2026-08-06T17:55:00.000Z',
          },
          {
            role: 'user',
            content: 'I feel stuck but I can keep going.',
            timestamp: '2026-08-06T18:00:00.000Z',
          },
        ],
        memoryItems: [
          {
            id: 'memory-1',
            category: 'project_context',
            content: 'The project codename is Север-17.',
            importance: 0.8,
          },
        ],
        goals: [],
        replyPlan: expect.objectContaining({
          dialogueAct: 'acknowledgement',
          latestUserSubstance: null,
          topicAnchor: 'I feel stuck but I can keep going.',
          questionPolicy: {
            maxQuestions: 0,
            reason: 'acknowledgement_no_new_substance',
          },
        }),
        replyPolicy: {
          maxChars: 120,
          maxQuestions: 0,
          allowReflectiveOpener: false,
          allowListFormatting: false,
        },
      },
    }));
    expect(ai.classifySituation).toHaveBeenCalledWith(
      [
        {
          role: 'assistant',
          content: 'Earlier reply',
          timestamp: new Date('2026-08-06T17:55:00.000Z'),
        },
        {
          role: 'user',
          content: 'I feel stuck but I can keep going.',
          timestamp: new Date('2026-08-06T18:00:00.000Z'),
        },
      ],
      {
        userName: 'Test User',
        now: expect.any(String),
        timezone: 'Europe/Warsaw',
      },
    );
    expect(db.client.select).toHaveBeenCalledTimes(3);
  });

  it('routes proactive check-in jobs through MAF primary and records sent probe metadata', async () => {
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
          text: 'Recent user context',
          senderType: 'user',
          direction: 'inbound',
          occurredAt: new Date('2026-08-11T08:00:00.000Z'),
        },
      ]),
    };
    const memoryQuery = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn(async () => []),
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
      },
    }));
    expect(agentRuntime.processMessage).toHaveBeenCalledWith(expect.objectContaining({
      requestPurpose: 'proactive_check_in',
      conversationId: '44444444-4444-4444-8444-444444444444',
      userId: '55555555-5555-4555-8555-555555555555',
      runtimeAttempt: 1,
      traceId: 'trace-check-in-1',
      messageText: 'Start a proactive pulse check-in about Role Clarity.',
      proactiveContext: {
        reason: 'pulse_check_in',
        probeQuestion: {
          id: '88888888-8888-4888-8888-888888888888',
          stableKey: 'role_clarity',
          title: 'Role Clarity',
          group: 'growth',
          probeStrategies: ['Ask what success looks like this week.'],
        },
      },
      runtimeContext: expect.objectContaining({
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
