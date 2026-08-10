import { describe, expect, it, vi } from 'vitest';
import type { Job } from 'bullmq';
import { ConversationProcessor, type ConversationJob } from './conversation.processor';

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

describe('ConversationProcessor runtime ledger recording', () => {
  it('passes durable runtime attempt metadata to the agent runtime', async () => {
    const agentRuntime = {
      processMessage: vi.fn(async () => runtimeResult),
    };
    const llmRunRepo = {
      record: vi.fn(async () => undefined),
    };
    const processor = new ConversationProcessor(
      agentRuntime as never,
      {} as never,
      llmRunRepo as never,
      {} as never,
    );

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
    const processor = new ConversationProcessor(
      agentRuntime as never,
      {} as never,
      llmRunRepo as never,
      {} as never,
    );

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
          text: 'I feel stuck but I can keep going.',
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
          text: 'I feel stuck but I can keep going.',
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
    const db = {
      client: {
        select: vi.fn().mockReturnValueOnce(currentQuery).mockReturnValueOnce(recentQuery),
      },
    };
    const processor = new ConversationProcessor(
      agentRuntime as never,
      {} as never,
      llmRunRepo as never,
      db as never,
    );

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
        memoryItems: [],
        goals: [],
      },
    }));
    expect(db.client.select).toHaveBeenCalledTimes(2);
  });
});
