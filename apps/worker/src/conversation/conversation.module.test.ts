import { describe, expect, it, vi } from 'vitest';
import type { RuntimeResult } from '@entalent/contracts';
import type { ProcessMessageResult } from '@entalent/application';
import {
  createMafPrimaryRuntimePort,
  createMafAgentRuntimeClientFromEnv,
  toRuntimeFailureReason,
  toShadowDiagnosticsParams,
} from './conversation.module';

describe('toRuntimeFailureReason', () => {
  it.each([
    [new Error('raw user text: hello from message'), 'runtime_failed'],
    [new Error('fallback_closed_after_actions_committed'), 'fallback_closed_after_actions_committed'],
    [new Error('runtime_timeout'), 'runtime_timeout'],
    [new Error('maf_runtime_fetch_failed'), 'maf_runtime_fetch_failed'],
    [new Error(''), 'runtime_failed'],
    ['runtime_unavailable', 'runtime_failed'],
  ])('maps %j to a stable ledger failure reason', (error, expected) => {
    expect(toRuntimeFailureReason(error)).toBe(expected);
  });
});

describe('createMafAgentRuntimeClientFromEnv', () => {
  it('does not require agent-service URLs for worker module construction', () => {
    expect(() => createMafAgentRuntimeClientFromEnv({})).not.toThrow();
  });

  it('uses process env values when caller env misses them', () => {
    const originalInternalUrl = process.env.AGENT_SERVICE_INTERNAL_URL;
    const originalUrl = process.env.AGENT_SERVICE_URL;
    try {
      process.env.AGENT_SERVICE_INTERNAL_URL = 'https://agent-service.process-env';
      process.env.AGENT_SERVICE_URL = 'https://agent-service.compat';

      const client = createMafAgentRuntimeClientFromEnv({});
      expect(client.optionsSnapshot()).toEqual({
        serviceUrl: 'https://agent-service.process-env',
        serviceAuthConfigured: false,
      });
    } finally {
      if (originalInternalUrl === undefined) {
        delete process.env.AGENT_SERVICE_INTERNAL_URL;
      } else {
        process.env.AGENT_SERVICE_INTERNAL_URL = originalInternalUrl;
      }
      if (originalUrl === undefined) {
        delete process.env.AGENT_SERVICE_URL;
      } else {
        process.env.AGENT_SERVICE_URL = originalUrl;
      }
    }
  });

  it('prefers AGENT_SERVICE_INTERNAL_URL over the compatibility AGENT_SERVICE_URL alias', () => {
    const client = createMafAgentRuntimeClientFromEnv({
      AGENT_SERVICE_INTERNAL_URL: 'https://agent-service.internal',
      AGENT_SERVICE_URL: 'https://agent-service.public',
      AGENT_SERVICE_TIMEOUT_MS: '1234',
      INTERNAL_SERVICE_AUTH_SECRET: 'x'.repeat(32),
    });

    expect(client.optionsSnapshot()).toEqual({
      serviceUrl: 'https://agent-service.internal',
      timeoutMs: 1234,
      serviceAuthConfigured: true,
    });
  });

  it('preserves invalid timeout configuration as a safe MAF diagnostic', () => {
    const client = createMafAgentRuntimeClientFromEnv({
      AGENT_SERVICE_INTERNAL_URL: 'https://agent-service.internal',
      AGENT_SERVICE_TIMEOUT_MS: 'bad-timeout',
    });

    expect(client.getConfigurationDiagnostic({
      requestId: 'request-1',
      eventId: 'event-1',
      runtimeAttempt: 1,
      messageId: 'msg-1',
      conversationId: 'conv-1',
      userId: 'user-1',
      tenantId: 'tenant-1',
      externalWorkspaceId: 'workspace-1',
      externalConversationId: 'channel-1',
      traceId: 'trace-1',
    })).toEqual({
      reasonCode: 'maf_runtime_configuration_invalid',
      invalidConfigKeys: ['AGENT_SERVICE_TIMEOUT_MS'],
    });
  });
});

describe('createMafPrimaryRuntimePort', () => {
  it('uses MAF primary as the worker runtime and commits the ledger attempt', async () => {
    const runtimeLedger = {
      recordStartedAttempt: vi.fn(async () => ({ id: 'attempt-1' })),
      markReplyCommitted: vi.fn(async () => undefined),
      markFailed: vi.fn(async () => undefined),
      recordCandidateReceived: vi.fn(async () => undefined),
      recordActionsValidated: vi.fn(async () => undefined),
      markActionsCommitted: vi.fn(async () => undefined),
      recordActionEnvelopes: vi.fn(async () => []),
    };
    const port = createMafPrimaryRuntimePort({
      conversationRepo: {
        findById: vi.fn(async () => ({
          channelType: 'slack',
          userTimezone: 'Europe/Warsaw',
          userTimezoneUpdatedAt: new Date(),
        })),
        saveMessage: vi.fn(async () => ({ id: 'outbound-1' })),
      } as never,
      outbox: {
        enqueueMessageSend: vi.fn(async () => undefined),
      } as never,
      mafRuntime: {
        getConfigurationDiagnostic: vi.fn(() => null),
        processCandidate: vi.fn(async () => candidateResult),
      },
      featureFlags: {
        isEnabled: vi.fn(async () => false),
      } as never,
      riskSignalRepo: undefined,
      escalation: undefined,
      runtimeLedger: runtimeLedger as never,
    });

    const result = await port.processMessage(primaryRequest);

    expect(result.responseText).toBe('Candidate reply with private detail');
    expect(result.outboundMessageId).toBe('outbound-1');
    expect(runtimeLedger.recordStartedAttempt).toHaveBeenCalledWith(expect.objectContaining({
      runtimeMode: 'maf_primary',
      requestId: 'request-1',
      eventId: 'event-1',
      messageId: 'message-1',
      runtimeAttempt: 1,
    }));
    expect(runtimeLedger.recordCandidateReceived).toHaveBeenCalledWith('attempt-1');
    expect(runtimeLedger.recordActionsValidated).toHaveBeenCalledWith('attempt-1');
    expect(runtimeLedger.markActionsCommitted).toHaveBeenCalledWith('attempt-1');
    expect(runtimeLedger.recordActionEnvelopes).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      runtimeAttemptId: 'attempt-1',
      actions: [],
    });
    expect(runtimeLedger.markReplyCommitted).toHaveBeenCalledWith('attempt-1');
    expect(runtimeLedger.markFailed).not.toHaveBeenCalled();
  });

  it('fails the MAF primary ledger attempt instead of falling back to TypeScript', async () => {
    const runtimeLedger = {
      recordStartedAttempt: vi.fn(async () => ({ id: 'attempt-1' })),
      markReplyCommitted: vi.fn(async () => undefined),
      markFailed: vi.fn(async () => undefined),
      recordCandidateReceived: vi.fn(async () => undefined),
      recordActionsValidated: vi.fn(async () => undefined),
      markActionsCommitted: vi.fn(async () => undefined),
      recordActionEnvelopes: vi.fn(async () => []),
    };
    const port = createMafPrimaryRuntimePort({
      conversationRepo: {
        findById: vi.fn(),
        saveMessage: vi.fn(),
      } as never,
      outbox: {
        enqueueMessageSend: vi.fn(),
      } as never,
      mafRuntime: {
        getConfigurationDiagnostic: vi.fn(() => null),
        processCandidate: vi.fn(async () => {
          throw new Error('maf_runtime_fetch_failed');
        }),
      },
      featureFlags: undefined,
      riskSignalRepo: undefined,
      escalation: undefined,
      runtimeLedger: runtimeLedger as never,
    });

    await expect(port.processMessage(primaryRequest)).rejects.toThrow('maf_runtime_fetch_failed');
    expect(runtimeLedger.markFailed).toHaveBeenCalledWith('attempt-1', 'maf_runtime_fetch_failed');
    expect(runtimeLedger.recordCandidateReceived).not.toHaveBeenCalled();
    expect(runtimeLedger.recordActionsValidated).not.toHaveBeenCalled();
    expect(runtimeLedger.markActionsCommitted).not.toHaveBeenCalled();
    expect(runtimeLedger.recordActionEnvelopes).not.toHaveBeenCalled();
    expect(runtimeLedger.markReplyCommitted).not.toHaveBeenCalled();
  });

  it('records proposed actions from a valid primary candidate before reply commit', async () => {
    const runtimeLedger = {
      recordStartedAttempt: vi.fn(async () => ({ id: 'attempt-1' })),
      markReplyCommitted: vi.fn(async () => undefined),
      markFailed: vi.fn(async () => undefined),
      recordCandidateReceived: vi.fn(async () => undefined),
      recordActionsValidated: vi.fn(async () => undefined),
      markActionsCommitted: vi.fn(async () => undefined),
      recordActionEnvelopes: vi.fn(async () => []),
    };
    const proposedAction: RuntimeResult['proposedActions'][number] = {
      actionId: 'action-1',
      actionType: 'save_memory',
      aggregateType: 'memory',
      idempotencyKey: 'idem-1',
      payload: {
        memoryCandidateId: 'memory-candidate-1',
      },
      validationResult: {
        status: 'valid',
        reasonCodes: [],
      },
      executionStatus: 'not_started',
      commitMarker: null,
    };
    const port = createMafPrimaryRuntimePort({
      conversationRepo: {
        findById: vi.fn(async () => ({
          channelType: 'slack',
          userTimezone: 'Europe/Warsaw',
          userTimezoneUpdatedAt: new Date(),
        })),
        saveMessage: vi.fn(async () => ({ id: 'outbound-1' })),
      } as never,
      outbox: {
        enqueueMessageSend: vi.fn(async () => undefined),
      } as never,
      mafRuntime: {
        getConfigurationDiagnostic: vi.fn(() => null),
        processCandidate: vi.fn(async () => ({
          ...candidateResult,
          proposedActions: [proposedAction],
        })),
      } as never,
      featureFlags: {
        isEnabled: vi.fn(async () => false),
      } as never,
      riskSignalRepo: undefined,
      escalation: undefined,
      runtimeLedger: runtimeLedger as never,
    });

    await port.processMessage({
      ...primaryRequest,
      runtimeAttempt: 1,
      eventId: 'event-1',
      requestId: 'request-1',
    });

    expect(runtimeLedger.recordActionEnvelopes).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      runtimeAttemptId: 'attempt-1',
      actions: [proposedAction],
    });
  });
});

const currentResult: ProcessMessageResult = {
  outboundMessageId: 'outbound-1',
  responseText: 'TypeScript reply with private detail',
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

const primaryRequest = {
  requestId: 'request-1',
  eventId: 'event-1',
  runtimeAttempt: 1,
  messageId: 'message-1',
  conversationId: 'conversation-1',
  userId: 'user-1',
  tenantId: 'tenant-1',
  externalWorkspaceId: 'workspace-1',
  externalConversationId: 'channel-1',
  traceId: 'trace-1',
  messageText: 'hello',
  messageCreatedAt: '2026-08-06T18:00:00.000Z',
  conversationSessionKey: 'workspace-1:user-1:channel-1:dm',
  runtimeContext: {
    recentTurns: [],
    memoryItems: [],
    goals: [],
  },
};

const candidateResult: RuntimeResult = {
  reply: {
    text: 'Candidate reply with private detail',
    mode: 'normal',
  },
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
  riskAssessment: {
    type: null,
    severity: 'none',
    confidence: 0,
    evidence: [],
    immediateResponseRequired: false,
    escalationRecommended: false,
    surveyMustBeBlocked: false,
    proactiveMessagesMustBePaused: false,
  },
  memoryCandidates: [],
  proposedActions: [],
  diagnostics: {
    traceId: 'trace-1',
    runtimeVersion: 'maf-candidate-test',
    runtimeAttempt: 1,
    modelCalls: 1,
    toolCalls: 0,
    latencyMs: 42,
    retryCount: 0,
    modelRetryCount: 0,
    toolRetryCount: 0,
    httpRetryCount: 0,
  },
};

describe('toShadowDiagnosticsParams', () => {
  it('maps a valid MAF candidate record to TypeScript-owned shadow diagnostics params', () => {
    expect(toShadowDiagnosticsParams({
      request: {
        requestId: 'request-1',
        eventId: 'event-1',
        runtimeAttempt: 1,
        messageId: 'message-1',
        conversationId: 'conversation-1',
        userId: 'user-1',
        tenantId: 'tenant-1',
        externalWorkspaceId: 'workspace-1',
        externalConversationId: 'channel-1',
        traceId: 'trace-1',
      },
      decision: {
        mode: 'maf_shadow',
        decisionSource: 'shadow_flag',
      },
      runtimeAttemptId: 'attempt-1',
      currentResult,
      candidateResult,
      validationStatus: 'valid',
    })).toMatchObject({
      tenantId: 'tenant-1',
      messageId: 'message-1',
      runtimeAttemptId: 'attempt-1',
      runtimeMode: 'maf_shadow',
      traceId: 'trace-1',
      runtimeVersion: 'maf-candidate-test',
      validationStatus: 'valid',
      latencyMs: 42,
      modelCallCount: 1,
      toolCallCount: 0,
      retryCount: 0,
      estimatedCost: 0,
      validationDetails: {
        status: 'valid',
        reasonCode: 'maf_candidate_valid',
        invalidFields: [],
        missingCanonicalFields: [],
      },
    });
  });

  it('maps invalid candidate diagnostics without copying raw provider errors into validation details', () => {
    const params = toShadowDiagnosticsParams({
      request: {
        requestId: 'request-1',
        eventId: 'event-1',
        runtimeAttempt: 1,
        messageId: 'message-1',
        conversationId: 'conversation-1',
        userId: 'user-1',
        tenantId: 'tenant-1',
        externalWorkspaceId: 'workspace-1',
        externalConversationId: 'channel-1',
        traceId: 'trace-1',
      },
      decision: {
        mode: 'maf_shadow',
        decisionSource: 'shadow_flag',
      },
      runtimeAttemptId: 'attempt-1',
      currentResult,
      validationStatus: 'invalid',
      diagnostic: {
        reasonCode: 'maf_runtime_response_invalid',
        invalidFields: ['$.diagnostics.retryCount'],
      },
    });

    expect(params).toMatchObject({
      runtimeVersion: 'maf-candidate-validation-failed',
      validationStatus: 'invalid',
      validationDetails: {
        status: 'invalid',
        reasonCode: 'maf_runtime_response_invalid',
        reasonCodes: ['maf_runtime_response_invalid'],
        invalidFields: ['$.diagnostics.retryCount'],
        missingCanonicalFields: [],
      },
    });
    expect(JSON.stringify(params?.validationDetails)).not.toContain('private detail');
    expect(JSON.stringify(params?.validationDetails)).not.toContain('provider');
  });

  it('sets explicit maf_candidate_invalid when invalid shadow candidate lacks a candidate diagnostic', () => {
    const params = toShadowDiagnosticsParams({
      request: {
        requestId: 'request-1',
        eventId: 'event-1',
        runtimeAttempt: 1,
        messageId: 'message-1',
        conversationId: 'conversation-1',
        userId: 'user-1',
        tenantId: 'tenant-1',
        externalWorkspaceId: 'workspace-1',
        externalConversationId: 'channel-1',
        traceId: 'trace-1',
      },
      decision: {
        mode: 'maf_shadow',
        decisionSource: 'shadow_flag',
      },
      runtimeAttemptId: 'attempt-1',
      currentResult,
      validationStatus: 'invalid',
    });

    expect(params?.validationDetails).toMatchObject({
      status: 'invalid',
      reasonCode: 'maf_candidate_invalid',
      reasonCodes: ['maf_candidate_invalid'],
      missingCanonicalFields: [],
      invalidFields: [],
    });
  });

  it('does not write shadow diagnostics without a runtime attempt id', () => {
    expect(toShadowDiagnosticsParams({
      request: {
        messageId: 'message-1',
        conversationId: 'conversation-1',
        userId: 'user-1',
        tenantId: 'tenant-1',
        externalWorkspaceId: 'workspace-1',
        externalConversationId: 'channel-1',
        traceId: 'trace-1',
      },
      decision: {
        mode: 'maf_shadow',
        decisionSource: 'shadow_flag',
      },
      currentResult,
      validationStatus: 'invalid',
    })).toBeNull();
  });
});
