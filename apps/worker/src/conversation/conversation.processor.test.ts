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

  it('Style adaptation maf_primary regression enriches the runtime request without sentinel turns', async () => {
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
          text: 'I feel stuck but I can keep going.\n*Sent using* <@U0BPHHA21GC|ChatGPT>',
          occurredAt: new Date('2026-08-06T18:00:00.000Z'),
          externalThreadId: 'thread-1',
          userPreferredName: 'Test User',
          userTimezone: 'Europe/Warsaw',
          userLocale: 'en-US',
          styleDimensions: {
            register: 1.8,
            humor: 0.45,
            verbosity: -0.25,
            emoji: 0.1,
          },
          stylePhrases: [
            { text: 'quick read', count: 3 },
            { text: 'net-net', count: 2 },
            { text: 'ship it', count: 1 },
            { text: 'extra phrase', count: 1 },
            { text: 'fifth phrase', count: 1 },
            { text: 'sixth phrase', count: 1 },
          ],
          styleAdaptationWeight: '0.30',
        },
      ]),
    };
    const recentQuery = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn(async () => [
        {
          text: 'I feel stuck but I can keep going.\n*Sent using* <@U0BPHHA21GC|ChatGPT>',
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
          tenantId: 'tenant-1',
          userId: 'user-1',
          category: 'project_context',
          content: 'The project codename is Север-17.',
          importance: '0.80',
          status: 'active',
          expiresAt: null,
          supersededById: null,
          createdAt: new Date('2026-08-06T17:00:00.000Z'),
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
        styleAdaptation: {
          dimensions: {
            register: 1,
            humor: 0.45,
            verbosity: 0,
            emoji: 0.1,
          },
          weight: 0.3,
          phrases: ['quick read', 'net-net', 'ship it', 'extra phrase', 'fifth phrase'],
        },
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

  it('Long-term memory maf_primary regression excludes inactive memory and keeps deterministic order', async () => {
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
          text: 'Can you help me decide what to do next?',
          occurredAt: new Date('2026-08-06T18:00:00.000Z'),
          externalThreadId: null,
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
          text: 'Can you help me decide what to do next?',
          senderType: 'user',
          direction: 'inbound',
          occurredAt: new Date('2026-08-06T18:00:00.000Z'),
        },
      ]),
    };
    const included = Array.from({ length: 13 }, (_, index) => ({
      id: `memory-active-${index + 1}`,
      tenantId: 'tenant-1',
      userId: 'user-1',
      category: 'project_context',
      content: `Active memory ${index + 1}`,
      importance: index >= 11 ? '0.99' : String((0.5 + index / 100).toFixed(2)),
      status: 'active',
      expiresAt: null,
      supersededById: null,
      createdAt: new Date(index >= 11 ? '2026-08-06T17:59:30.000Z' : `2026-08-06T17:${String(index).padStart(2, '0')}:00.000Z`),
    }));
    const dbMemoryRows = [
      included[0],
      {
        id: 'memory-deleted',
        tenantId: 'tenant-1',
        userId: 'user-1',
        category: 'project_context',
        content: 'Deleted memory must not reach MAF.',
        importance: '1.00',
        status: 'deleted',
        expiresAt: null,
        supersededById: null,
        createdAt: new Date('2026-08-06T17:59:00.000Z'),
      },
      {
        id: 'memory-superseded',
        tenantId: 'tenant-1',
        userId: 'user-1',
        category: 'project_context',
        content: 'Superseded memory must not reach MAF.',
        importance: '0.99',
        status: 'active',
        expiresAt: null,
        supersededById: 'memory-active-13',
        createdAt: new Date('2026-08-06T17:58:00.000Z'),
      },
      {
        id: 'memory-expired',
        tenantId: 'tenant-1',
        userId: 'user-1',
        category: 'project_context',
        content: 'Expired memory must not reach MAF.',
        importance: '0.98',
        status: 'active',
        expiresAt: new Date('2020-01-01T00:00:00.000Z'),
        supersededById: null,
        createdAt: new Date('2026-08-06T17:57:00.000Z'),
      },
      {
        id: 'memory-other-tenant',
        tenantId: 'tenant-2',
        userId: 'user-1',
        category: 'project_context',
        content: 'Other tenant memory must not reach MAF.',
        importance: '0.97',
        status: 'active',
        expiresAt: null,
        supersededById: null,
        createdAt: new Date('2026-08-06T17:56:00.000Z'),
      },
      {
        id: 'memory-other-user',
        tenantId: 'tenant-1',
        userId: 'user-2',
        category: 'project_context',
        content: 'Other user memory must not reach MAF.',
        importance: '0.96',
        status: 'active',
        expiresAt: null,
        supersededById: null,
        createdAt: new Date('2026-08-06T17:55:00.000Z'),
      },
      ...included.slice(1),
    ];
    const memoryCutoff = new Date('2026-08-06T18:00:00.000Z');
    const memoryQuery = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn(async (limit: number) =>
        dbMemoryRows
          .filter(
            (row) =>
              row.tenantId === 'tenant-1' &&
              row.userId === 'user-1' &&
              row.status === 'active' &&
              !row.supersededById &&
              (!row.expiresAt || row.expiresAt > memoryCutoff),
          )
          .sort(
            (a, b) =>
              Number(b.importance) - Number(a.importance) ||
              b.createdAt.getTime() - a.createdAt.getTime() ||
              b.id.localeCompare(a.id),
          )
          .slice(0, limit),
      ),
    };
    const db = {
      client: {
        select: vi.fn().mockReturnValueOnce(currentQuery).mockReturnValueOnce(recentQuery).mockReturnValueOnce(memoryQuery),
      },
    };
    const { processor } = createProcessor({ agentRuntime, llmRunRepo, db });

    await processor.process({
      id: 'job-1',
      name: 'process',
      attemptsMade: 0,
      data: jobData,
    } as Job<ConversationJob>);

    const request = (agentRuntime.processMessage.mock.calls as unknown as Array<[
      { runtimeContext: { memoryItems: Array<{ id: string }> } },
    ]>)[0][0];
    expect(request.runtimeContext.memoryItems).toHaveLength(12);
    expect(request.runtimeContext.memoryItems.map((item: { id: string }) => item.id)).toEqual([
      'memory-active-13',
      'memory-active-12',
      'memory-active-11',
      'memory-active-10',
      'memory-active-9',
      'memory-active-8',
      'memory-active-7',
      'memory-active-6',
      'memory-active-5',
      'memory-active-4',
      'memory-active-3',
      'memory-active-2',
    ]);
    expect(request.runtimeContext.memoryItems[0]).toEqual({
      id: 'memory-active-13',
      category: 'project_context',
      content: 'Active memory 13',
      importance: 0.99,
    });
    expect(request.runtimeContext.memoryItems).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'memory-deleted' }),
        expect.objectContaining({ id: 'memory-superseded' }),
        expect.objectContaining({ id: 'memory-expired' }),
        expect.objectContaining({ id: 'memory-other-tenant' }),
        expect.objectContaining({ id: 'memory-other-user' }),
        expect.objectContaining({ id: 'memory-active-1' }),
      ]),
    );
    expect(memoryQuery.limit).toHaveBeenCalledWith(12);
  });

  it('builds typed social reply context when the classifier returns social_checkin intent', async () => {
    const agentRuntime = {
      processMessage: vi.fn(async () => runtimeResult),
    };
    const currentQuery = {
      from: vi.fn().mockReturnThis(),
      leftJoin: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn(async () => [
        {
          text: 'как ты?\n*Sent using* <@U0BPHHA21GC|ChatGPT>',
          occurredAt: new Date('2026-08-13T14:04:39.000Z'),
          externalThreadId: null,
          userPreferredName: 'Serhii',
          userTimezone: 'Europe/Warsaw',
          userLocale: 'ru-RU',
        },
      ]),
    };
    const recentQuery = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn(async () => [
        {
          text: 'как ты?\n*Sent using* <@U0BPHHA21GC|ChatGPT>',
          senderType: 'user',
          direction: 'inbound',
          occurredAt: new Date('2026-08-13T14:04:39.000Z'),
        },
      ]),
    };
    const memoryQuery = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn(async () => []),
    };
    const db = {
      client: {
        select: vi.fn().mockReturnValueOnce(currentQuery).mockReturnValueOnce(recentQuery).mockReturnValueOnce(memoryQuery),
      },
    };
    const ai = {
      classifySituation: vi.fn(async () => ({
        ...runtimeResult.classification,
        primaryIntent: 'social_checkin',
        secondaryIntents: [],
        emotionalState: ['neutral'],
        urgency: 'low',
        confidence: 0.94,
        requiresSafetyCheck: false,
        surveyAllowed: true,
        reasoningSummary: 'The latest employee message is a social check-in.',
        dialogueAct: 'social_checkin',
        latestUserSubstance: null,
        topicAnchor: null,
      })),
    };
    const { processor } = createProcessor({ agentRuntime, db, ai });

    await processor.process({
      id: 'job-1',
      name: 'process',
      attemptsMade: 0,
      data: jobData,
    } as Job<ConversationJob>);

    expect(agentRuntime.processMessage).toHaveBeenCalledWith(expect.objectContaining({
      messageText: 'как ты?',
      runtimeContext: expect.objectContaining({
        replyPlan: expect.objectContaining({
          dialogueAct: 'social_checkin',
          responseMove: 'social_reply',
          questionPolicy: {
            maxQuestions: 1,
            reason: 'social_checkin_returns_question',
          },
          forbiddenMoves: expect.arrayContaining(['operational_status']),
        }),
        replyPolicy: {
          maxChars: 120,
          maxQuestions: 1,
          allowReflectiveOpener: false,
          allowListFormatting: false,
        },
      }),
    }));
  });

  it('derives asked-recently reply planning only from outbound reply-shape metadata', async () => {
    const agentRuntime = {
      processMessage: vi.fn(async () => runtimeResult),
    };
    const currentQuery = {
      from: vi.fn().mockReturnThis(),
      leftJoin: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn(async () => [
        {
          text: 'same blocker',
          occurredAt: new Date('2026-08-13T14:05:39.000Z'),
          externalThreadId: null,
          userPreferredName: 'Serhii',
          userTimezone: 'Europe/Warsaw',
          userLocale: 'ru-RU',
        },
      ]),
    };
    const recentQuery = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn(async () => [
        {
          text: 'same blocker',
          metadata: {},
          senderType: 'user',
          direction: 'inbound',
          occurredAt: new Date('2026-08-13T14:05:39.000Z'),
        },
        {
          text: 'what exactly is holding you back?',
          metadata: { replyShape: { askedQuestion: true, maxQuestions: 1 } },
          senderType: 'agent',
          direction: 'outbound',
          occurredAt: new Date('2026-08-13T14:04:39.000Z'),
        },
        {
          text: 'older statement.',
          metadata: { replyShape: { askedQuestion: false, maxQuestions: 0 } },
          senderType: 'agent',
          direction: 'outbound',
          occurredAt: new Date('2026-08-13T14:03:39.000Z'),
        },
      ]),
    };
    const memoryQuery = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn(async () => []),
    };
    const db = {
      client: {
        select: vi.fn().mockReturnValueOnce(currentQuery).mockReturnValueOnce(recentQuery).mockReturnValueOnce(memoryQuery),
      },
    };
    const ai = {
      classifySituation: vi.fn(async () => ({
        ...runtimeResult.classification,
        dialogueAct: 'continuation',
        latestUserSubstance: 'same blocker',
        topicAnchor: 'blocker',
      })),
    };
    const { processor } = createProcessor({ agentRuntime, db, ai });

    await processor.process({
      id: 'job-1',
      name: 'process',
      attemptsMade: 0,
      data: jobData,
    } as Job<ConversationJob>);

    expect(agentRuntime.processMessage).toHaveBeenCalledWith(expect.objectContaining({
      runtimeContext: expect.objectContaining({
        replyPlan: expect.objectContaining({
          questionPolicy: {
            maxQuestions: 0,
            reason: 'asked_recently',
          },
        }),
      }),
    }));
  });

  it('marks reply planning unavailable when the typed classifier fails', async () => {
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
          text: 'как ты?\n*Sent using* <@U0BPHHA21GC|ChatGPT>',
          occurredAt: new Date('2026-08-13T13:18:26.000Z'),
          externalThreadId: null,
          userPreferredName: 'Test User',
          userTimezone: 'Europe/Warsaw',
          userLocale: 'ru',
        },
      ]),
    };
    const recentQuery = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn(async () => [
        {
          text: 'как ты?\n*Sent using* <@U0BPHHA21GC|ChatGPT>',
          senderType: 'user',
          direction: 'inbound',
          occurredAt: new Date('2026-08-13T13:18:26.000Z'),
        },
      ]),
    };
    const memoryQuery = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn(async () => []),
    };
    const db = {
      client: {
        select: vi.fn().mockReturnValueOnce(currentQuery).mockReturnValueOnce(recentQuery).mockReturnValueOnce(memoryQuery),
      },
    };
    const ai = {
      classifySituation: vi.fn(async () => {
        throw new Error('classifier schema mismatch');
      }),
    };
    const { processor } = createProcessor({ agentRuntime, llmRunRepo, db, ai });

    await processor.process({
      id: 'job-1',
      name: 'process',
      attemptsMade: 0,
      data: jobData,
    } as Job<ConversationJob>);

    expect(agentRuntime.processMessage).toHaveBeenCalledWith(expect.objectContaining({
      messageText: 'как ты?',
      runtimeContext: expect.objectContaining({
        replyPlanning: {
          status: 'unavailable',
          reason: 'classifier_failed',
        },
      }),
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
