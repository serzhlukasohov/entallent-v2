import { describe, expect, it, vi } from 'vitest';
import type { Job } from 'bullmq';
import { ConversationProcessor, type ConversationJob } from './conversation.processor';

const jobData: ConversationJob = {
  requestId: 'request-1',
  eventId: 'event-1',
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
  it('records a started runtime attempt before invoking the agent runtime', async () => {
    const callOrder: string[] = [];
    const agentRuntime = {
      processMessage: vi.fn(async () => {
        callOrder.push('runtime');
        return runtimeResult;
      }),
    };
    const runtimeLedgerRepo = {
      recordStartedAttempt: vi.fn(async () => {
        callOrder.push('ledger');
        return { id: 'attempt-1' };
      }),
    };
    const llmRunRepo = {
      record: vi.fn(async () => undefined),
    };
    const processor = new ConversationProcessor(
      agentRuntime as never,
      {} as never,
      llmRunRepo as never,
      runtimeLedgerRepo as never,
      {} as never,
    );

    await processor.process({
      id: 'job-1',
      name: 'process',
      attemptsMade: 0,
      data: jobData,
    } as Job<ConversationJob>);

    expect(runtimeLedgerRepo.recordStartedAttempt).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      requestId: 'request-1',
      eventId: 'event-1',
      messageId: 'message-1',
      runtimeAttempt: 1,
      traceId: 'trace-1',
      runtimeMode: 'typescript',
    });
    expect(agentRuntime.processMessage).toHaveBeenCalledWith({
      messageId: 'message-1',
      conversationId: 'conversation-1',
      userId: 'user-1',
      tenantId: 'tenant-1',
      externalWorkspaceId: 'workspace-1',
      externalConversationId: 'channel-1',
      traceId: 'trace-1',
    });
    expect(callOrder).toEqual(['ledger', 'runtime']);
  });
});
