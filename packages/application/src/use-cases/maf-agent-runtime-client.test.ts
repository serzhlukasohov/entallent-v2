import { describe, expect, it, vi } from 'vitest';
import type { RuntimeResult } from '@entalent/contracts';
import type { ProcessMessageRequest } from '../ports/agent-runtime.port';
import {
  MafAgentRuntimeClient,
  MafAgentRuntimeConfigurationError,
} from './maf-agent-runtime-client';
import * as applicationExports from '../index';

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
};

const CANDIDATE_REQUEST: ProcessMessageRequest = {
  ...REQUEST,
  messageText: 'I feel stuck but I can keep going.',
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
        content: 'I feel stuck but I can keep going.',
        timestamp: '2026-08-06T18:00:00.000Z',
      },
    ],
    memoryItems: [],
    goals: [],
  },
};

const CANDIDATE_RESULT: RuntimeResult = {
  reply: {
    text: 'That sounds heavy. What would make the next step smaller?',
    mode: 'normal',
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
  classification: {
    primaryIntent: 'casual_conversation',
    secondaryIntents: [],
    emotionalState: [],
    urgency: 'low',
    confidence: 0.91,
    requiresSafetyCheck: false,
    surveyAllowed: true,
    reasoningSummary: 'candidate classification is redacted in outputs',
    reminderRequest: null,
    dialogueAct: 'new_substance',
    latestUserSubstance: 'raw candidate user substance',
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

describe('MafAgentRuntimeClient', () => {
  it('can be constructed without agent-service URL configuration', () => {
    expect(() => new MafAgentRuntimeClient()).not.toThrow();
  });

  it('fails closed with a stable diagnostic when service URL is missing', async () => {
    const fetchImpl = vi.fn();
    const client = new MafAgentRuntimeClient({ fetch: fetchImpl });

    await expect(client.processMessage(REQUEST)).rejects.toMatchObject({
      reasonCode: 'maf_runtime_configuration_missing',
      safeDiagnostic: {
        reasonCode: 'maf_runtime_configuration_missing',
        missingConfigKeys: ['AGENT_SERVICE_INTERNAL_URL'],
      },
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('fails closed before fetch when the configured service URL is invalid', async () => {
    const fetchImpl = vi.fn();
    const client = new MafAgentRuntimeClient({
      serviceUrl: 'file:///tmp/agent-service.sock',
      fetch: fetchImpl,
    });

    await expect(client.processMessage(REQUEST)).rejects.toMatchObject({
      reasonCode: 'maf_runtime_url_invalid',
      safeDiagnostic: {
        reasonCode: 'maf_runtime_url_invalid',
        invalidConfigKeys: ['AGENT_SERVICE_INTERNAL_URL'],
      },
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects malformed http URLs before fetch', async () => {
    const fetchImpl = vi.fn();
    const client = new MafAgentRuntimeClient({
      serviceUrl: 'http://localhost:abc',
      fetch: fetchImpl,
    });

    await expect(client.processMessage(REQUEST)).rejects.toMatchObject({
      reasonCode: 'maf_runtime_url_invalid',
      safeDiagnostic: {
        reasonCode: 'maf_runtime_url_invalid',
        invalidConfigKeys: ['AGENT_SERVICE_INTERNAL_URL'],
      },
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('reports invalid optional config without exposing configured values', async () => {
    const fetchImpl = vi.fn();
    const client = new MafAgentRuntimeClient({
      serviceUrl: 'https://agent-service.internal',
      invalidConfigKeys: ['AGENT_SERVICE_TIMEOUT_MS'],
      fetch: fetchImpl,
    });

    await expect(client.processMessage(REQUEST)).rejects.toMatchObject({
      reasonCode: 'maf_runtime_configuration_invalid',
      safeDiagnostic: {
        reasonCode: 'maf_runtime_configuration_invalid',
        invalidConfigKeys: ['AGENT_SERVICE_TIMEOUT_MS'],
      },
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    [{ ...REQUEST, requestId: '' }, ['requestId']],
    [{ ...REQUEST, eventId: '   ' }, ['eventId']],
    [{ ...REQUEST, runtimeAttempt: 0 }, ['runtimeAttempt']],
    [{ ...REQUEST, runtimeAttempt: 1.5 }, ['runtimeAttempt']],
    [{ ...REQUEST, traceId: '' }, ['traceId']],
  ] as const)(
    'fails closed before fetch for invalid runtime boundary fields %#',
    async (request, invalidFields) => {
      const fetchImpl = vi.fn();
      const client = new MafAgentRuntimeClient({
        serviceUrl: 'https://agent-service.internal',
        fetch: fetchImpl,
      });

      await expect(client.processMessage(request)).rejects.toMatchObject({
        reasonCode: 'maf_runtime_boundary_request_invalid',
        safeDiagnostic: {
          reasonCode: 'maf_runtime_boundary_request_invalid',
          invalidFields,
        },
      });
      expect(fetchImpl).not.toHaveBeenCalled();
    },
  );

  it('does not fabricate the canonical runtime request when current port fields are incomplete', async () => {
    const fetchImpl = vi.fn();
    const client = new MafAgentRuntimeClient({
      serviceUrl: 'https://agent-service.internal',
      fetch: fetchImpl,
    });

    await expect(client.processMessage(REQUEST)).rejects.toMatchObject({
      reasonCode: 'maf_runtime_boundary_request_invalid',
      safeDiagnostic: {
        reasonCode: 'maf_runtime_boundary_request_invalid',
        missingCanonicalFields: [
          'conversation.sessionKey',
          'message.text',
          'message.createdAt',
          'context',
        ],
      },
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('posts a canonical shadow candidate request and validates the runtime result', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => CANDIDATE_RESULT,
    }));
    const client = new MafAgentRuntimeClient({
      serviceUrl: 'https://agent-service.internal/',
      timeoutMs: 2500,
      fetch: fetchImpl,
    });

    await expect(client.processCandidate(CANDIDATE_REQUEST)).resolves.toEqual(CANDIDATE_RESULT);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://agent-service.internal/runtime/process-message',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-trace-id': 'trace-1',
        },
        body: expect.any(String),
        signal: expect.anything(),
      }),
    );

    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, { body?: string }];
    const body = JSON.parse(String(init?.body));
    expect(body).toEqual({
      requestId: '11111111-1111-4111-8111-111111111111',
      eventId: '22222222-2222-4222-8222-222222222222',
      traceId: 'trace-1',
      idempotencyKey:
        'runtime:workspace-1:55555555-5555-4555-8555-555555555555:channel-1:33333333-3333-4333-8333-333333333333:1',
      runtimeAttempt: 1,
      tenant: {
        id: 'tenant-1',
        workspaceId: 'workspace-1',
      },
      user: {
        id: '55555555-5555-4555-8555-555555555555',
        displayName: 'Test User',
        timezone: 'Europe/Warsaw',
        locale: 'en-US',
      },
      conversation: {
        id: '44444444-4444-4444-8444-444444444444',
        channel: 'slack',
        externalWorkspaceId: 'workspace-1',
        externalConversationId: 'channel-1',
        threadId: 'thread-1',
        sessionKey: 'workspace-1:55555555-5555-4555-8555-555555555555:channel-1:dm',
      },
      message: {
        id: '33333333-3333-4333-8333-333333333333',
        text: 'I feel stuck but I can keep going.',
        createdAt: '2026-08-06T18:00:00.000Z',
      },
      context: CANDIDATE_REQUEST.runtimeContext,
    });
  });

  it('serializes proactive check-in context into the canonical runtime request', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => CANDIDATE_RESULT,
    }));
    const client = new MafAgentRuntimeClient({
      serviceUrl: 'https://agent-service.internal/',
      fetch: fetchImpl,
    });
    const proactiveRequest: ProcessMessageRequest = {
      ...CANDIDATE_REQUEST,
      requestPurpose: 'proactive_check_in',
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
    };

    await client.processCandidate(proactiveRequest);

    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, { body?: string }];
    const body = JSON.parse(String(init?.body));
    expect(body).toEqual(expect.objectContaining({
      requestPurpose: 'proactive_check_in',
      proactiveContext: proactiveRequest.proactiveContext,
    }));
  });

  it('uses the global fetch implementation and default timeout when no test fetch is injected', async () => {
    const originalFetch = (globalThis as unknown as { fetch?: unknown }).fetch;
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => CANDIDATE_RESULT,
    }));
    (globalThis as unknown as { fetch?: unknown }).fetch = fetchImpl;
    const client = new MafAgentRuntimeClient({
      serviceUrl: 'https://agent-service.internal',
    });

    try {
      await expect(client.processCandidate(CANDIDATE_REQUEST)).resolves.toEqual(CANDIDATE_RESULT);
    } finally {
      (globalThis as unknown as { fetch?: unknown }).fetch = originalFetch;
    }

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://agent-service.internal/runtime/process-message',
      expect.objectContaining({
        signal: expect.anything(),
      }),
    );
  });

  it('fails with fetch failure when runtime fetch is unavailable', async () => {
    const originalFetch = (globalThis as unknown as { fetch?: unknown }).fetch;
    (globalThis as unknown as { fetch?: unknown }).fetch = undefined;
    const client = new MafAgentRuntimeClient({
      serviceUrl: 'https://agent-service.internal',
    });

    try {
      await expect(client.processCandidate(CANDIDATE_REQUEST)).rejects.toMatchObject({
        reasonCode: 'maf_runtime_fetch_failed',
        safeDiagnostic: {
          reasonCode: 'maf_runtime_fetch_failed',
        },
      });
    } finally {
      (globalThis as unknown as { fetch?: unknown }).fetch = originalFetch;
    }
  });

  it('fails closed before fetch when canonical shadow fields are missing', async () => {
    const fetchImpl = vi.fn();
    const client = new MafAgentRuntimeClient({
      serviceUrl: 'https://agent-service.internal',
      fetch: fetchImpl,
    });

    await expect(client.processCandidate(REQUEST)).rejects.toMatchObject({
      reasonCode: 'maf_runtime_boundary_request_invalid',
      safeDiagnostic: {
        reasonCode: 'maf_runtime_boundary_request_invalid',
        missingCanonicalFields: [
          'conversation.sessionKey',
          'message.text',
          'message.createdAt',
          'context',
        ],
      },
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('maps invalid runtime results to a safe diagnostic without leaking raw response text', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        ...CANDIDATE_RESULT,
        classification: undefined,
        reply: {
          text: 'raw reply with bearer token secret-token',
        },
      }),
    }));
    const client = new MafAgentRuntimeClient({
      serviceUrl: 'https://agent-service.internal',
      serviceAuthSecret: 'super-secret-service-auth-token',
      fetch: fetchImpl,
    });

    const error = await client
      .processCandidate(CANDIDATE_REQUEST)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(MafAgentRuntimeConfigurationError);
    expect(error).toMatchObject({
      reasonCode: 'maf_runtime_response_invalid',
      safeDiagnostic: {
        reasonCode: 'maf_runtime_response_invalid',
        invalidFields: ['$.classification'],
      },
    });
    const diagnostic = JSON.stringify((error as MafAgentRuntimeConfigurationError).safeDiagnostic);
    expect(diagnostic).not.toContain('secret-token');
    expect(diagnostic).not.toContain('super-secret-service-auth-token');
    expect(diagnostic).not.toContain('raw reply');
  });

  it('keeps diagnostics redacted from secrets, response bodies, and request payload content', async () => {
    const client = new MafAgentRuntimeClient({
      serviceUrl: 'not-a-url-with-secret-token',
      serviceAuthSecret: 'super-secret-service-auth-token',
      fetch: vi.fn(),
    });

    const error = await client.processMessage(REQUEST).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(MafAgentRuntimeConfigurationError);
    const diagnostic = JSON.stringify((error as MafAgentRuntimeConfigurationError).safeDiagnostic);
    expect(diagnostic).not.toContain('super-secret-service-auth-token');
    expect(diagnostic).not.toContain('not-a-url-with-secret-token');
    expect(diagnostic).not.toContain('msg-1');
    expect(diagnostic).not.toContain('channel-1');
    expect(diagnostic).not.toContain('workspace-1');
  });

  it('exports only the intended disabled client runtime surface from the application package', () => {
    expect(applicationExports.MafAgentRuntimeClient).toBe(MafAgentRuntimeClient);
    expect(applicationExports.MafAgentRuntimeConfigurationError).toBe(
      MafAgentRuntimeConfigurationError,
    );
    expect(applicationExports).not.toHaveProperty('MafWorkflow');
    expect(applicationExports).not.toHaveProperty('MafToolRegistry');
    expect(applicationExports).not.toHaveProperty('MafShadowExecutor');
    expect(applicationExports).not.toHaveProperty('MafCanaryGate');
  });
});
