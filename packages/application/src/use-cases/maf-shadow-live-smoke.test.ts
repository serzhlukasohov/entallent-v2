import { describe, expect, it, vi } from 'vitest';
import type { RuntimeResult } from '@entalent/contracts';
import * as applicationExports from '../index';
import { resolveMafShadowLiveSmokeEnv, runMafShadowLiveSmoke } from './maf-shadow-live-smoke';
import type { ProcessMessageRequest, ProcessMessageResult } from '../ports/agent-runtime.port';

const CANDIDATE_RESULT: RuntimeResult = {
  reply: {
    text: 'candidate text with sk-proj-secret',
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
      idempotencyKey: 'action:live-shadow-smoke',
      payload: {
        executeAt: '2026-08-06T19:00:00.000Z',
        intent: 'candidate action payload must not leak',
        deduplicationKey: 'live-shadow-smoke',
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
    reasoningSummary: 'shadow candidate classification should remain internal',
    reminderRequest: null,
    dialogueAct: 'new_substance',
    latestUserSubstance: 'candidate user substance',
    topicAnchor: null,
  },
  diagnostics: {
    traceId: 'trace-live-maf-shadow-smoke',
    runtimeVersion: 'agent-service-maf-core/1.13.0',
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

describe('runMafShadowLiveSmoke', () => {
  it('returns valid redacted evidence when the HTTP candidate is contract-valid and modelCalls is 1', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => CANDIDATE_RESULT,
    }));

    const evidence = await runMafShadowLiveSmoke({
      serviceUrl: 'http://127.0.0.1:8001',
      fetch: fetchImpl,
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      'http://127.0.0.1:8001/runtime/process-message',
      expect.objectContaining({
        method: 'POST',
        body: expect.any(String),
      }),
    );
    expect(evidence).toEqual({
      status: 'valid',
      validationStatus: 'contract_valid',
      traceId: 'trace-runtime-contract-valid-request',
      userFacing: {
        mode: 'normal',
        primaryIntent: 'casual_conversation',
        riskSeverity: 'none',
      },
      shadow: {
        mode: 'maf_shadow',
        decisionSource: 'shadow_flag',
        runtimeVersion: 'agent-service-maf-core/1.13.0',
        modelCalls: 1,
        toolCalls: 0,
        retryCount: 0,
        riskSeverity: 'none',
        actionCount: 1,
        memoryCandidateCount: 1,
      },
    });
    expect(JSON.stringify(evidence)).not.toContain('candidate text');
    expect(JSON.stringify(evidence)).not.toContain('sk-proj-secret');
    expect(JSON.stringify(evidence)).not.toContain('candidate memory content');
    expect(JSON.stringify(evidence)).not.toContain('candidate action payload');
    expect(JSON.stringify(evidence)).not.toContain('risk evidence');
    expect(JSON.stringify(evidence)).not.toContain('Local live MAF shadow smoke request');
    expect(JSON.stringify(evidence)).not.toContain('TypeScript user-facing smoke reply');
  });

  it('fails when the candidate is contract-valid but modelCalls is not 1', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        ...CANDIDATE_RESULT,
        diagnostics: {
          ...CANDIDATE_RESULT.diagnostics,
          modelCalls: 0,
        },
      }),
    }));

    const evidence = await runMafShadowLiveSmoke({
      serviceUrl: 'http://127.0.0.1:8001',
      fetch: fetchImpl,
    });

    expect(evidence).toMatchObject({
      status: 'invalid',
      validationStatus: 'contract_valid',
      failureReason: 'model_call_count_invalid',
      shadow: {
        modelCalls: 0,
      },
    });
  });

  it('reports HTTP and contract failures without leaking provider bodies', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 502,
      json: async () => ({
        detail: 'provider body with bearer token must not leak',
      }),
    }));

    const evidence = await runMafShadowLiveSmoke({
      serviceUrl: 'http://127.0.0.1:8001',
      fetch: fetchImpl,
    });

    expect(evidence).toMatchObject({
      status: 'invalid',
      validationStatus: 'contract_invalid',
      failureReason: 'maf_runtime_http_failed',
      shadow: {
        diagnostic: {
          reasonCode: 'maf_runtime_http_failed',
          invalidFields: ['http_status:502'],
        },
      },
    });
    expect(JSON.stringify(evidence)).not.toContain('provider body');
    expect(JSON.stringify(evidence)).not.toContain('bearer token');
  });

  it('reports invalid runtime results with safe response diagnostics', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        ...CANDIDATE_RESULT,
        classification: undefined,
        reply: {
          text: 'invalid candidate text with sk-proj-secret',
        },
        diagnostics: {
          ...CANDIDATE_RESULT.diagnostics,
        },
      }),
    }));

    const evidence = await runMafShadowLiveSmoke({
      serviceUrl: 'http://127.0.0.1:8001',
      fetch: fetchImpl,
    });

    expect(evidence).toMatchObject({
      status: 'invalid',
      validationStatus: 'contract_invalid',
      failureReason: 'maf_runtime_response_invalid',
      shadow: {
        diagnostic: {
          reasonCode: 'maf_runtime_response_invalid',
          invalidFields: ['$.classification'],
        },
      },
    });
    expect(JSON.stringify(evidence)).not.toContain('invalid candidate text');
    expect(JSON.stringify(evidence)).not.toContain('sk-proj-secret');
  });

  it('redacts injected raw request text, current reply text, and unsafe trace values', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 502,
      json: async () => ({
        detail: 'provider body with stack trace must not leak',
      }),
    }));

    const request: ProcessMessageRequest = {
      requestId: '11111111-1111-4111-8111-111111111111',
      eventId: '22222222-2222-4222-8222-222222222222',
      runtimeAttempt: 1,
      messageId: '33333333-3333-4333-8333-333333333333',
      conversationId: '44444444-4444-4444-8444-444444444444',
      userId: '55555555-5555-4555-8555-555555555555',
      tenantId: 'tenant-1',
      externalWorkspaceId: 'workspace-1',
      externalConversationId: 'channel-1',
      traceId: 'trace with raw text',
      messageText: 'raw request text must not leak',
      messageCreatedAt: '2026-08-06T18:00:00.000Z',
      conversationSessionKey: 'workspace-1:55555555-5555-4555-8555-555555555555:channel-1:dm',
      runtimeContext: {
        recentTurns: [
          {
            role: 'user',
            content: 'recent raw request turn must not leak',
            timestamp: '2026-08-06T18:00:00.000Z',
          },
        ],
        memoryItems: [],
        goals: [],
      },
    };
    const currentResult: ProcessMessageResult = {
      outboundMessageId: 'out-1',
      responseText: 'current TypeScript reply must not leak',
      mode: 'normal',
      classification: {
        primaryIntent: 'casual_conversation',
        secondaryIntents: [],
        emotionalState: [],
        urgency: 'low',
        confidence: 0.9,
        requiresSafetyCheck: false,
        surveyAllowed: true,
        reasoningSummary: 'current reasoning must not leak',
        reminderRequest: null,
        dialogueAct: 'new_substance',
        latestUserSubstance: 'latest user substance must not leak',
        topicAnchor: null,
      },
      risk: {
        riskType: null,
        severity: 'none',
        confidence: 0,
        evidence: ['current risk evidence must not leak'],
        immediateResponseRequired: false,
        escalationRecommended: false,
        surveyMustBeBlocked: false,
        proactiveMessagesMustBePaused: false,
        reasoningSummary: 'current risk reasoning must not leak',
      },
    };

    const evidence = await runMafShadowLiveSmoke({
      serviceUrl: 'http://127.0.0.1:8001',
      fetch: fetchImpl,
      request,
      currentResult,
    });

    expect(evidence.traceId).toBe('redacted');
    expect(JSON.stringify(evidence)).not.toContain('raw request text');
    expect(JSON.stringify(evidence)).not.toContain('recent raw request turn');
    expect(JSON.stringify(evidence)).not.toContain('current TypeScript reply');
    expect(JSON.stringify(evidence)).not.toContain('latest user substance');
    expect(JSON.stringify(evidence)).not.toContain('stack trace');
  });

  it('exports the live smoke helpers without exporting user-facing canary helpers', () => {
    expect(applicationExports.runMafShadowLiveSmoke).toBe(runMafShadowLiveSmoke);
    expect(applicationExports.resolveMafShadowLiveSmokeEnv).toBe(resolveMafShadowLiveSmokeEnv);
    expect(applicationExports).not.toHaveProperty('MafCanaryUserFacingRuntime');
    expect(applicationExports).not.toHaveProperty('MafCanaryEnablement');
  });
});

describe('resolveMafShadowLiveSmokeEnv', () => {
  it('infers Azure OpenAI local smoke config from root env aliases without returning secrets', () => {
    const resolution = resolveMafShadowLiveSmokeEnv({
      AZURE_OPENAI_ENDPOINT: 'https://example.openai.azure.com',
      AZURE_OPENAI_API_KEY: 'azure-secret-key',
      AZURE_OPENAI_API_VERSION: '2025-01-01-preview',
      OPENAI_MODEL_BALANCED: 'gpt-4.1',
    });

    expect(resolution).toEqual({
      provider: 'azure_openai',
      modelNameConfigured: true,
      env: {
        AGENT_SERVICE_MODEL_PROVIDER: 'azure_openai',
        AGENT_SERVICE_MODEL_NAME: 'gpt-4.1',
      },
      missingConfigKeys: [],
    });
    expect(JSON.stringify(resolution)).not.toContain('azure-secret-key');
  });

  it('reports stable missing config keys when provider and model cannot be inferred', () => {
    expect(resolveMafShadowLiveSmokeEnv({})).toEqual({
      modelNameConfigured: false,
      env: {},
      missingConfigKeys: ['AGENT_SERVICE_MODEL_PROVIDER', 'AGENT_SERVICE_MODEL_NAME'],
    });
  });

  it('does not infer a live provider when AGENT_SERVICE_MODEL_PROVIDER is explicitly disabled', () => {
    const resolution = resolveMafShadowLiveSmokeEnv({
      AGENT_SERVICE_MODEL_PROVIDER: 'disabled',
      OPENAI_API_KEY: 'sk-proj-secret',
      OPENAI_MODEL_BALANCED: 'gpt-4.1',
    });

    expect(resolution).toEqual({
      modelNameConfigured: true,
      env: {
        AGENT_SERVICE_MODEL_NAME: 'gpt-4.1',
      },
      missingConfigKeys: [],
      invalidConfigKeys: ['AGENT_SERVICE_MODEL_PROVIDER'],
    });
    expect(JSON.stringify(resolution)).not.toContain('sk-proj-secret');
  });

  it('does not infer a live provider when AGENT_SERVICE_MODEL_PROVIDER is malformed', () => {
    expect(
      resolveMafShadowLiveSmokeEnv({
        AGENT_SERVICE_MODEL_PROVIDER: 'azur_openai',
        AZURE_OPENAI_ENDPOINT: 'https://example.openai.azure.com',
        AZURE_OPENAI_API_KEY: 'azure-secret-key',
        AZURE_OPENAI_API_VERSION: '2025-01-01-preview',
        OPENAI_MODEL_BALANCED: 'gpt-4.1',
      }),
    ).toEqual({
      modelNameConfigured: true,
      env: {
        AGENT_SERVICE_MODEL_NAME: 'gpt-4.1',
      },
      missingConfigKeys: [],
      invalidConfigKeys: ['AGENT_SERVICE_MODEL_PROVIDER'],
    });
  });
});
