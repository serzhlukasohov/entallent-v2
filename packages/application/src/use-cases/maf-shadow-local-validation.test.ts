import { describe, expect, it, vi } from 'vitest';
import type { RuntimeResult } from '@entalent/contracts';
import type { ProcessMessageRequest, ProcessMessageResult } from '../ports/agent-runtime.port';
import * as applicationExports from '../index';
import { MafAgentRuntimeClient } from './maf-agent-runtime-client';
import { runMafShadowLocalValidation } from './maf-shadow-local-validation';
import type { TypeScriptAgentRuntime } from './typescript-agent-runtime';

const REQUEST: ProcessMessageRequest = {
  requestId: '11111111-1111-4111-8111-111111111111',
  eventId: '22222222-2222-4222-8222-222222222222',
  runtimeAttempt: 1,
  messageId: '33333333-3333-4333-8333-333333333333',
  conversationId: '44444444-4444-4444-8444-444444444444',
  userId: '55555555-5555-4555-8555-555555555555',
  tenantId: 'tenant-1',
  externalWorkspaceId: 'workspace-1',
  externalConversationId: 'channel-1',
  traceId: 'trace-1',
  messageText: 'raw local user text with bearer-token-secret',
  messageCreatedAt: '2026-08-06T18:00:00.000Z',
  userDisplayName: 'Test User',
  userTimezone: 'Europe/Warsaw',
  userLocale: 'en-US',
  conversationSessionKey: 'workspace-1:55555555-5555-4555-8555-555555555555:channel-1:dm',
  conversationThreadId: 'thread-1',
  runtimeContext: {
    recentTurns: [
      {
        role: 'user',
        content: 'raw recent turn memory content',
        timestamp: '2026-08-06T18:00:00.000Z',
      },
    ],
    memoryItems: [],
    goals: [],
  },
};

const CURRENT_RESULT: ProcessMessageResult = {
  outboundMessageId: 'out-1',
  responseText: 'TypeScript current reply with secret current-token',
  mode: 'normal',
  classification: {
    primaryIntent: 'casual_conversation',
    secondaryIntents: [],
    emotionalState: [],
    urgency: 'low',
    confidence: 0.9,
    requiresSafetyCheck: false,
    surveyAllowed: true,
    reasoningSummary: 'current reasoning must not be evidence',
    reminderRequest: null,
    dialogueAct: 'new_substance',
    latestUserSubstance: 'latest user substance must not leak',
    topicAnchor: null,
  },
  risk: {
    riskType: null,
    severity: 'none',
    confidence: 0,
    evidence: ['risk evidence must not leak'],
    immediateResponseRequired: false,
    escalationRecommended: false,
    surveyMustBeBlocked: false,
    proactiveMessagesMustBePaused: false,
    reasoningSummary: 'risk reasoning must not leak',
  },
};

const CANDIDATE_RESULT: RuntimeResult = {
  reply: {
    text: 'Python candidate reply with candidate-token',
    mode: 'normal',
  },
  riskAssessment: {
    type: null,
    severity: 'none',
    confidence: 0,
    evidence: ['candidate risk evidence must not leak'],
    immediateResponseRequired: false,
    escalationRecommended: false,
    surveyMustBeBlocked: false,
    proactiveMessagesMustBePaused: false,
  },
  memoryCandidates: [
    {
      actionId: 'memory-candidate-1',
      type: 'preference',
      content: 'candidate memory content must not leak',
      confidence: 0.8,
      sensitivity: 'normal',
      sourceMessageIds: ['33333333-3333-4333-8333-333333333333'],
    },
  ],
  proposedActions: [
    {
      actionId: 'action-1',
      aggregateType: 'follow_up',
      actionType: 'schedule_follow_up',
      idempotencyKey: 'action:shadow-validation-follow-up',
      payload: {
        executeAt: '2026-08-06T19:00:00.000Z',
        intent: 'candidate action payload must not leak',
        deduplicationKey: 'shadow-validation-follow-up',
      },
      validationResult: {
        status: 'valid',
        reasonCodes: [],
      },
      executionStatus: 'not_started',
      commitMarker: null,
    },
  ],
  classification: {
    primaryIntent: 'casual_conversation',
    secondaryIntents: [],
    emotionalState: [],
    urgency: 'low',
    confidence: 0.91,
    requiresSafetyCheck: false,
    surveyAllowed: true,
    reasoningSummary: 'shadow validation candidate classification is internal',
    reminderRequest: null,
    dialogueAct: 'new_substance',
    latestUserSubstance: 'candidate user substance',
    topicAnchor: null,
  },
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

describe('runMafShadowLocalValidation', () => {
  it('fails closed without service config and does not call fetch', async () => {
    const fetchImpl = vi.fn();
    const currentRuntime = runtimeResolving(CURRENT_RESULT);
    const mafRuntime = new MafAgentRuntimeClient({ fetch: fetchImpl });

    const evidence = await runMafShadowLocalValidation({
      request: REQUEST,
      currentRuntime,
      mafRuntime,
    });

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(currentRuntime.processMessage).toHaveBeenCalledWith(REQUEST);
    expect(evidence).toEqual({
      validationStatus: 'invalid',
      traceId: 'trace-1',
      runtimeAttempt: 1,
      userFacing: {
        mode: 'normal',
        primaryIntent: 'casual_conversation',
        riskSeverity: 'none',
      },
      shadow: {
        mode: 'maf_shadow',
        decisionSource: 'shadow_flag',
        diagnostic: {
          reasonCode: 'maf_runtime_configuration_missing',
          missingConfigKeys: ['AGENT_SERVICE_INTERNAL_URL'],
        },
      },
    });
  });

  it('records a valid redacted candidate through MafAgentRuntimeClient while keeping TypeScript user-facing', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => CANDIDATE_RESULT,
    }));
    const currentRuntime = runtimeResolving(CURRENT_RESULT);
    const mafRuntime = new MafAgentRuntimeClient({
      serviceUrl: 'https://agent-service.internal',
      fetch: fetchImpl,
    });

    const evidence = await runMafShadowLocalValidation({
      request: REQUEST,
      currentRuntime,
      mafRuntime,
      runtimeAttemptId: 'attempt-1',
    });

    expect(currentRuntime.processMessage).toHaveBeenCalledWith(REQUEST);
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://agent-service.internal/runtime/process-message',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-trace-id': 'trace-1',
        },
        body: expect.any(String),
      }),
    );
    expect(evidence).toEqual({
      validationStatus: 'valid',
      traceId: 'trace-1',
      runtimeAttempt: 1,
      runtimeAttemptId: 'attempt-1',
      userFacing: {
        mode: 'normal',
        primaryIntent: 'casual_conversation',
        riskSeverity: 'none',
      },
      shadow: {
        mode: 'maf_shadow',
        decisionSource: 'shadow_flag',
        runtimeVersion: 'maf-candidate-test',
        modelCalls: 1,
        toolCalls: 0,
        retryCount: 0,
        riskSeverity: 'none',
        actionCount: 1,
        memoryCandidateCount: 1,
      },
    });
    expect(JSON.stringify(evidence)).not.toContain('raw local user text');
    expect(JSON.stringify(evidence)).not.toContain('secret current-token');
    expect(JSON.stringify(evidence)).not.toContain('candidate-token');
    expect(JSON.stringify(evidence)).not.toContain('candidate memory content');
    expect(JSON.stringify(evidence)).not.toContain('candidate action payload');
    expect(JSON.stringify(evidence)).not.toContain('risk evidence');
  });

  it('reports HTTP failures with stable diagnostics and still returns TypeScript-facing evidence', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 503,
      json: async () => ({
        detail: 'provider body with bearer token must not leak',
      }),
    }));
    const currentRuntime = runtimeResolving(CURRENT_RESULT);
    const mafRuntime = new MafAgentRuntimeClient({
      serviceUrl: 'https://agent-service.internal',
      fetch: fetchImpl,
    });

    const evidence = await runMafShadowLocalValidation({
      request: REQUEST,
      currentRuntime,
      mafRuntime,
    });

    expect(evidence.validationStatus).toBe('invalid');
    expect(evidence.userFacing).toEqual({
      mode: 'normal',
      primaryIntent: 'casual_conversation',
      riskSeverity: 'none',
    });
    expect(evidence.shadow.diagnostic).toEqual({
      reasonCode: 'maf_runtime_http_failed',
      invalidFields: ['http_status:503'],
    });
    expect(JSON.stringify(evidence)).not.toContain('provider body');
    expect(JSON.stringify(evidence)).not.toContain('bearer token');
  });

  it('reports contract-invalid runtime results through MafAgentRuntimeClient validation', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        ...CANDIDATE_RESULT,
        classification: undefined,
        reply: {
          text: 'invalid candidate reply with sk-proj-secret',
        },
      }),
    }));
    const currentRuntime = runtimeResolving(CURRENT_RESULT);
    const mafRuntime = new MafAgentRuntimeClient({
      serviceUrl: 'https://agent-service.internal',
      fetch: fetchImpl,
    });

    const evidence = await runMafShadowLocalValidation({
      request: REQUEST,
      currentRuntime,
      mafRuntime,
    });

    expect(evidence.validationStatus).toBe('invalid');
    expect(evidence.shadow.diagnostic).toEqual({
      reasonCode: 'maf_runtime_response_invalid',
      invalidFields: ['$.classification'],
    });
    expect(JSON.stringify(evidence)).not.toContain('invalid candidate reply');
    expect(JSON.stringify(evidence)).not.toContain('sk-proj-secret');
  });

  it('redacts unsafe IDs and diagnostic values from serialized evidence', async () => {
    const currentRuntime = runtimeResolving(CURRENT_RESULT);
    const mafRuntime = {
      getConfigurationDiagnostic: vi.fn(() => null),
      processCandidate: vi.fn().mockRejectedValue(
        Object.assign(new Error('stack trace with secret'), {
          safeDiagnostic: {
            reasonCode: 'maf_runtime_response_invalid',
            invalidFields: [
              '$.reply.text',
              'raw provider body token',
              'sk-proj-validchars',
              'raw_recent_turn_memory_content',
            ],
          },
        }),
      ),
    };

    const evidence = await runMafShadowLocalValidation({
      request: {
        ...REQUEST,
        traceId: 'trace with raw user text',
      },
      currentRuntime,
      mafRuntime,
      runtimeAttemptId: 'attempt with secret',
    });

    expect(evidence.traceId).toBe('redacted');
    expect(evidence.runtimeAttemptId).toBe('redacted');
    expect(evidence.shadow.diagnostic).toEqual({
      reasonCode: 'maf_runtime_response_invalid',
      invalidFields: ['$.reply.text', 'redacted', 'redacted', 'redacted'],
    });
    expect(JSON.stringify(evidence)).not.toContain('raw provider body token');
    expect(JSON.stringify(evidence)).not.toContain('stack trace');
  });

  it('tolerates malformed diagnostic arrays and keeps evidence fail-closed', async () => {
    const currentRuntime = runtimeResolving(CURRENT_RESULT);
    const mafRuntime = {
      getConfigurationDiagnostic: vi.fn(() => null),
      processCandidate: vi.fn().mockRejectedValue(
        Object.assign(new Error('candidate failed'), {
          safeDiagnostic: {
            reasonCode: 'maf_runtime_response_invalid',
            invalidFields: '$.reply.text',
            missingConfigKeys: ['AGENT_SERVICE_INTERNAL_URL', 123, 'sk-proj-secret'],
            invalidConfigKeys: {
              raw: 'AGENT_SERVICE_URL',
            },
          },
        }),
      ),
    };

    const evidence = await runMafShadowLocalValidation({
      request: REQUEST,
      currentRuntime,
      mafRuntime,
    });

    expect(evidence.validationStatus).toBe('invalid');
    expect(evidence.shadow.diagnostic).toEqual({
      reasonCode: 'maf_runtime_response_invalid',
      missingConfigKeys: ['AGENT_SERVICE_INTERNAL_URL', 'redacted'],
    });
  });

  it('reports a stable diagnostic when no MAF runtime is injected', async () => {
    const currentRuntime = runtimeResolving(CURRENT_RESULT);

    const evidence = await runMafShadowLocalValidation({
      request: REQUEST,
      currentRuntime,
    });

    expect(evidence.validationStatus).toBe('invalid');
    expect(evidence.shadow.diagnostic).toEqual({
      reasonCode: 'maf_runtime_boundary_request_invalid',
      missingCanonicalFields: ['runtime_request_builder'],
    });
  });

  it('exports the local validation helper without exporting canary enablement helpers', () => {
    expect(applicationExports.runMafShadowLocalValidation).toBe(runMafShadowLocalValidation);
    expect(applicationExports).not.toHaveProperty('MafCanaryEnablement');
    expect(applicationExports).not.toHaveProperty('MafCanaryUserFacingRuntime');
    expect(applicationExports).not.toHaveProperty('MafWorkflow');
    expect(applicationExports).not.toHaveProperty('MafToolRegistry');
  });
});

function runtimeResolving(result: ProcessMessageResult): TypeScriptAgentRuntime {
  return {
    processMessage: vi.fn().mockResolvedValue(result),
  } as unknown as TypeScriptAgentRuntime;
}
