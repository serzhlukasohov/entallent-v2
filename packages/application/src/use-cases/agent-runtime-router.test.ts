import { describe, expect, it, vi } from 'vitest';
import type { RuntimeResult } from '@entalent/contracts';
import type { ProcessMessageRequest, ProcessMessageResult } from '../ports/agent-runtime.port';
import { AgentRuntimeRouter } from './agent-runtime-router';
import { MafAgentRuntimeClient } from './maf-agent-runtime-client';
import { MafPrimaryAgentRuntime } from './maf-primary-agent-runtime';
import type {
  AgentRuntimeConfigurationDiagnostic,
  AgentRuntimeFallbackExecutor,
  AgentRuntimeMode,
} from './agent-runtime-router';
import type { TypeScriptAgentRuntime } from './typescript-agent-runtime';

const REQUEST: ProcessMessageRequest = {
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
};

const PRIMARY_REQUEST: ProcessMessageRequest = {
  ...REQUEST,
  requestId: '11111111-1111-4111-8111-111111111111',
  eventId: '22222222-2222-4222-8222-222222222222',
  messageId: '33333333-3333-4333-8333-333333333333',
  conversationId: '44444444-4444-4444-8444-444444444444',
  userId: '55555555-5555-4555-8555-555555555555',
  messageText: 'I need help making this week less chaotic.',
  messageCreatedAt: '2026-08-07T10:00:00.000Z',
  userDisplayName: 'User One',
  conversationSessionKey: 'workspace-1:user-1:channel-1:thread-1',
  runtimeContext: {
    recentTurns: [],
    memoryItems: [],
    goals: [],
  },
};

const RESULT: ProcessMessageResult = {
  outboundMessageId: 'out-1',
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

const CANDIDATE_RESULT: RuntimeResult = {
  reply: {
    text: 'candidate reply',
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
    reasoningSummary: 'candidate',
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

describe('AgentRuntimeRouter', () => {
  it('defaults to the TypeScript runtime for each processMessage call', async () => {
    const typescriptRuntime = {
      processMessage: vi.fn().mockResolvedValue(RESULT),
    } as unknown as TypeScriptAgentRuntime;
    const router = new AgentRuntimeRouter(typescriptRuntime);

    await expect(router.processMessage(REQUEST)).resolves.toBe(RESULT);

    expect(typescriptRuntime.processMessage).toHaveBeenCalledTimes(1);
    expect(typescriptRuntime.processMessage).toHaveBeenCalledWith(REQUEST);
  });

  it('keeps TypeScript runtime compatibility for requests without strict MAF boundary fields', async () => {
    const legacyRequest: ProcessMessageRequest = {
      ...REQUEST,
      requestId: undefined,
      eventId: undefined,
      runtimeAttempt: undefined,
    };
    const typescriptRuntime = {
      processMessage: vi.fn().mockResolvedValue(RESULT),
    } as unknown as TypeScriptAgentRuntime;
    const router = new AgentRuntimeRouter(typescriptRuntime);

    await expect(router.processMessage(legacyRequest)).resolves.toBe(RESULT);

    expect(typescriptRuntime.processMessage).toHaveBeenCalledTimes(1);
    expect(typescriptRuntime.processMessage).toHaveBeenCalledWith(legacyRequest);
  });

  it('fails closed to the TypeScript runtime when mode evaluation throws', async () => {
    const typescriptRuntime = {
      processMessage: vi.fn().mockResolvedValue(RESULT),
    } as unknown as TypeScriptAgentRuntime;
    const logger = { info: vi.fn(), warn: vi.fn() };
    const router = new AgentRuntimeRouter(typescriptRuntime, {
      evaluateMode: () => {
        throw new Error('flag store unavailable');
      },
      logger,
    });

    await expect(router.processMessage(REQUEST)).resolves.toBe(RESULT);

    expect(typescriptRuntime.processMessage).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      'Agent runtime mode evaluation failed; falling back to TypeScript runtime',
      {
        traceId: 'trace-1',
        fallbackReason: 'runtime_mode_evaluation_failed',
      },
    );
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith('Agent runtime decision resolved', {
      traceId: 'trace-1',
      tenantId: 'tenant-1',
      userId: 'user-1',
      mode: 'typescript',
      decisionSource: 'evaluation_failure',
      fallbackReason: 'runtime_mode_evaluation_failed',
    });
    expect(logger.info).toHaveBeenCalledTimes(1);
  });

  it('still fails closed when recording the warning throws', async () => {
    const typescriptRuntime = {
      processMessage: vi.fn().mockResolvedValue(RESULT),
    } as unknown as TypeScriptAgentRuntime;
    const router = new AgentRuntimeRouter(typescriptRuntime, {
      evaluateMode: () => {
        throw new Error('flag store unavailable');
      },
      logger: {
        warn: () => {
          throw new Error('logger unavailable');
        },
      },
    });

    await expect(router.processMessage(REQUEST)).resolves.toBe(RESULT);

    expect(typescriptRuntime.processMessage).toHaveBeenCalledTimes(1);
    expect(typescriptRuntime.processMessage).toHaveBeenCalledWith(REQUEST);
  });

  it('keeps maf_disabled as a TypeScript-only path until a MAF runtime exists', async () => {
    const typescriptRuntime = {
      processMessage: vi.fn().mockResolvedValue(RESULT),
    } as unknown as TypeScriptAgentRuntime;
    const router = new AgentRuntimeRouter(typescriptRuntime, {
      evaluateMode: () => 'maf_disabled',
    });

    await expect(router.processMessage(REQUEST)).resolves.toBe(RESULT);

    expect(typescriptRuntime.processMessage).toHaveBeenCalledTimes(1);
    expect(typescriptRuntime.processMessage).toHaveBeenCalledWith(REQUEST);
  });

  it.each(['typescript', 'maf_disabled', 'maf_shadow', 'maf_canary'] as const)(
    'continues to delegate %s mode to TypeScript runtime while no MAF client exists',
    async (mode) => {
      const typescriptRuntime = {
        processMessage: vi.fn().mockResolvedValue(RESULT),
      } as unknown as TypeScriptAgentRuntime;
      const router = new AgentRuntimeRouter(typescriptRuntime, {
        evaluateMode: () => ({ mode, decisionSource: 'typescript_default' }),
      });

      await expect(router.processMessage(REQUEST)).resolves.toBe(RESULT);

      expect(typescriptRuntime.processMessage).toHaveBeenCalledTimes(1);
      expect(typescriptRuntime.processMessage).toHaveBeenCalledWith(REQUEST);
    },
  );

  it('runs primary MAF before TypeScript and returns the primary result when maf_primary is selected', async () => {
    const typescriptRuntime = {
      processMessage: vi.fn().mockResolvedValue(RESULT),
    } as unknown as TypeScriptAgentRuntime;
    const mafPrimaryRuntime = {
      processMessage: vi.fn().mockResolvedValue({
        ...RESULT,
        outboundMessageId: 'maf-out-1',
        responseText: 'maf primary reply',
      }),
    };
    const router = new AgentRuntimeRouter(typescriptRuntime, {
      evaluateMode: () => ({ mode: 'maf_primary', decisionSource: 'primary_flag' }),
      mafPrimaryRuntime,
    });

    await expect(router.processMessage(REQUEST)).resolves.toEqual({
      ...RESULT,
      outboundMessageId: 'maf-out-1',
      responseText: 'maf primary reply',
    });

    expect(mafPrimaryRuntime.processMessage).toHaveBeenCalledWith(REQUEST);
    expect(typescriptRuntime.processMessage).not.toHaveBeenCalled();
  });

  it('records primary success without exposing the primary response payload', async () => {
    const typescriptRuntime = {
      processMessage: vi.fn().mockResolvedValue(RESULT),
    } as unknown as TypeScriptAgentRuntime;
    const mafPrimaryRuntime = {
      processMessage: vi.fn().mockResolvedValue({
        ...RESULT,
        outboundMessageId: 'maf-out-1',
        responseText: 'raw primary reply must not enter callback',
      }),
    };
    const recordPrimarySuccess = vi.fn(async () => undefined);
    const router = new AgentRuntimeRouter(typescriptRuntime, {
      evaluateMode: () => ({ mode: 'maf_primary', decisionSource: 'primary_flag' }),
      recordDecision: vi.fn(async () => ({ runtimeAttemptId: 'attempt-1' })),
      recordPrimarySuccess,
      mafPrimaryRuntime,
    });

    await router.processMessage(REQUEST);

    expect(recordPrimarySuccess).toHaveBeenCalledWith({
      request: REQUEST,
      decision: {
        mode: 'maf_primary',
        decisionSource: 'primary_flag',
      },
      runtimeAttemptId: 'attempt-1',
    });
    const primarySuccessRecord = (recordPrimarySuccess.mock.calls as unknown as [[unknown]])[0]?.[0];
    expect(JSON.stringify(primarySuccessRecord)).not.toContain('raw primary reply');
  });

  it('fails closed when primary MAF reports a safe failure', async () => {
    const primaryError = new Error('provider failed');
    Object.assign(primaryError, {
      safeDiagnostic: {
        reasonCode: 'maf_runtime_fetch_failed',
      },
    });
    const typescriptRuntime = {
      processMessage: vi.fn().mockResolvedValue(RESULT),
    } as unknown as TypeScriptAgentRuntime;
    const mafPrimaryRuntime = {
      processMessage: vi.fn().mockRejectedValue(primaryError),
    };
    const recordDecision = vi.fn(async () => ({ runtimeAttemptId: 'attempt-1' }));
    const recordPrimaryFailure = vi.fn(async () => undefined);
    const executeFallback = vi.fn(async <T>(
      _request: ProcessMessageRequest,
      fallback: () => Promise<T> | T,
    ): Promise<T> => fallback()) as AgentRuntimeFallbackExecutor;
    const logger = { info: vi.fn(), warn: vi.fn() };
    const router = new AgentRuntimeRouter(typescriptRuntime, {
      evaluateMode: () => ({ mode: 'maf_primary', decisionSource: 'primary_flag' }),
      mafPrimaryRuntime,
      recordDecision,
      recordPrimaryFailure,
      executeFallback,
      logger,
    });

    await expect(router.processMessage(REQUEST)).rejects.toBe(primaryError);

    expect(recordPrimaryFailure).toHaveBeenCalledWith({
      request: REQUEST,
      decision: {
        mode: 'maf_primary',
        decisionSource: 'primary_flag',
      },
      diagnostic: {
        reasonCode: 'maf_runtime_fetch_failed',
      },
      runtimeAttemptId: 'attempt-1',
    });
    expect(executeFallback).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith('MAF primary failed before commit; failing closed', {
      traceId: 'trace-1',
      mode: 'maf_primary',
      decisionSource: 'primary_flag',
      fallbackReason: 'maf_runtime_fetch_failed',
    });
    expect(typescriptRuntime.processMessage).not.toHaveBeenCalled();
  });

  it('fails proactive primary check-ins closed when primary MAF reports a safe failure', async () => {
    const primaryError = new Error('provider failed');
    Object.assign(primaryError, {
      safeDiagnostic: {
        reasonCode: 'maf_runtime_fetch_failed',
      },
    });
    const proactiveRequest: ProcessMessageRequest = {
      ...PRIMARY_REQUEST,
      requestPurpose: 'proactive_check_in',
      proactiveContext: { reason: 'pulse_check_in' },
    };
    const typescriptRuntime = {
      processMessage: vi.fn().mockResolvedValue(RESULT),
    } as unknown as TypeScriptAgentRuntime;
    const mafPrimaryRuntime = {
      processMessage: vi.fn().mockRejectedValue(primaryError),
    };
    const recordDecision = vi.fn(async () => ({ runtimeAttemptId: 'attempt-1' }));
    const recordPrimaryFailure = vi.fn(async () => undefined);
    const executeFallback = vi.fn(async <T>(
      _request: ProcessMessageRequest,
      fallback: () => Promise<T> | T,
    ): Promise<T> => fallback()) as AgentRuntimeFallbackExecutor;
    const router = new AgentRuntimeRouter(typescriptRuntime, {
      evaluateMode: () => ({ mode: 'maf_primary', decisionSource: 'primary_flag' }),
      mafPrimaryRuntime,
      recordDecision,
      recordPrimaryFailure,
      executeFallback,
    });

    await expect(router.processMessage(proactiveRequest)).rejects.toBe(primaryError);

    expect(recordPrimaryFailure).toHaveBeenCalledWith({
      request: proactiveRequest,
      decision: {
        mode: 'maf_primary',
        decisionSource: 'primary_flag',
      },
      diagnostic: {
        reasonCode: 'maf_runtime_fetch_failed',
      },
      runtimeAttemptId: 'attempt-1',
    });
    expect(executeFallback).not.toHaveBeenCalled();
    expect(typescriptRuntime.processMessage).not.toHaveBeenCalled();
  });

  it('preserves the primary MAF error when generic failure recording throws', async () => {
    const primaryError = new Error('provider failed');
    Object.assign(primaryError, {
      safeDiagnostic: {
        reasonCode: 'maf_runtime_fetch_failed',
      },
    });
    const typescriptRuntime = {
      processMessage: vi.fn().mockResolvedValue(RESULT),
    } as unknown as TypeScriptAgentRuntime;
    const mafPrimaryRuntime = {
      processMessage: vi.fn().mockRejectedValue(primaryError),
    };
    const recordFailure = vi.fn(async () => {
      throw new Error('failure recorder unavailable');
    });
    const router = new AgentRuntimeRouter(typescriptRuntime, {
      evaluateMode: () => ({ mode: 'maf_primary', decisionSource: 'primary_flag' }),
      mafPrimaryRuntime,
      recordFailure,
    });

    await expect(router.processMessage(REQUEST)).rejects.toBe(primaryError);

    expect(recordFailure).toHaveBeenCalledWith(
      REQUEST,
      {
        mode: 'maf_primary',
        decisionSource: 'primary_flag',
      },
      primaryError,
    );
    expect(typescriptRuntime.processMessage).not.toHaveBeenCalled();
  });

  it('fails proactive check-ins closed when runtime mode evaluation throws', async () => {
    const proactiveRequest: ProcessMessageRequest = {
      ...PRIMARY_REQUEST,
      requestPurpose: 'proactive_check_in',
      proactiveContext: { reason: 'pulse_check_in' },
    };
    const typescriptRuntime = {
      processMessage: vi.fn().mockResolvedValue(RESULT),
    } as unknown as TypeScriptAgentRuntime;
    const router = new AgentRuntimeRouter(typescriptRuntime, {
      evaluateMode: () => {
        throw new Error('flag store unavailable');
      },
    });

    await expect(router.processMessage(proactiveRequest)).rejects.toThrow(
      'maf_proactive_runtime_mode_evaluation_failed',
    );

    expect(typescriptRuntime.processMessage).not.toHaveBeenCalled();
  });

  it('records diagnostics and fails closed when primary MAF config is missing', async () => {
    const typescriptRuntime = {
      processMessage: vi.fn().mockResolvedValue(RESULT),
    } as unknown as TypeScriptAgentRuntime;
    const recordConfigurationDiagnostic = vi.fn(async () => undefined);
    const recordPrimaryFailure = vi.fn(async () => undefined);
    const executeFallback = vi.fn(async <T>(
      _request: ProcessMessageRequest,
      fallback: () => Promise<T> | T,
    ): Promise<T> => fallback()) as AgentRuntimeFallbackExecutor;
    const mafRuntime = new MafAgentRuntimeClient({ fetch: vi.fn() });
    const router = new AgentRuntimeRouter(typescriptRuntime, {
      evaluateMode: () => ({ mode: 'maf_primary', decisionSource: 'primary_flag' }),
      mafRuntime,
      recordConfigurationDiagnostic,
      recordPrimaryFailure,
      executeFallback,
    });

    await expect(router.processMessage(REQUEST)).rejects.toThrow('maf_runtime_configuration_missing');

    expect(recordConfigurationDiagnostic).toHaveBeenCalledWith({
      mode: 'maf_primary',
      decisionSource: 'primary_flag',
      reasonCode: 'maf_runtime_configuration_missing',
      missingConfigKeys: ['AGENT_SERVICE_INTERNAL_URL'],
    });
    expect(recordPrimaryFailure).toHaveBeenCalledWith({
      request: REQUEST,
      decision: {
        mode: 'maf_primary',
        decisionSource: 'primary_flag',
      },
      diagnostic: {
        reasonCode: 'maf_runtime_configuration_missing',
        missingConfigKeys: ['AGENT_SERVICE_INTERNAL_URL'],
      },
    });
    expect(executeFallback).not.toHaveBeenCalled();
    expect(typescriptRuntime.processMessage).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: 'missing config',
      client: new MafAgentRuntimeClient({ fetch: vi.fn() }),
      expectedDiagnostic: {
        reasonCode: 'maf_runtime_configuration_missing',
        missingConfigKeys: ['AGENT_SERVICE_INTERNAL_URL'],
      },
    },
    {
      name: 'invalid URL',
      client: new MafAgentRuntimeClient({ serviceUrl: 'file:///tmp/agent-service', fetch: vi.fn() }),
      expectedDiagnostic: {
        reasonCode: 'maf_runtime_url_invalid',
        invalidConfigKeys: ['AGENT_SERVICE_INTERNAL_URL'],
      },
    },
    {
      name: 'HTTP failure',
      client: new MafAgentRuntimeClient({
        serviceUrl: 'http://127.0.0.1:8001',
        fetch: vi.fn(async () => ({ ok: false, status: 503, json: async () => ({ raw: 'body' }) })),
      }),
      expectedDiagnostic: {
        reasonCode: 'maf_runtime_http_failed',
        invalidFields: ['http_status:503'],
      },
    },
    {
      name: 'invalid RuntimeResult',
      client: new MafAgentRuntimeClient({
        serviceUrl: 'http://127.0.0.1:8001',
        fetch: vi.fn(async () => ({
          ok: true,
          status: 200,
          json: async () => ({ reply: { text: 'invalid because mode is missing' } }),
        })),
      }),
      expectedDiagnostic: {
        reasonCode: 'maf_runtime_response_invalid',
        invalidFields: expect.any(Array),
      },
    },
  ])('fails closed through the primary adapter for $name before TypeScript commits', async ({
    client,
    expectedDiagnostic,
  }) => {
    const typescriptRuntime = {
      processMessage: vi.fn().mockResolvedValue(RESULT),
    } as unknown as TypeScriptAgentRuntime;
    const recordPrimaryFailure = vi.fn(async () => undefined);
    const executeFallback = vi.fn(async <T>(
      _request: ProcessMessageRequest,
      fallback: () => Promise<T> | T,
    ): Promise<T> => fallback()) as AgentRuntimeFallbackExecutor;
    const router = new AgentRuntimeRouter(typescriptRuntime, {
      evaluateMode: () => ({ mode: 'maf_primary', decisionSource: 'primary_flag' }),
      recordDecision: vi.fn(async () => ({ runtimeAttemptId: 'attempt-1' })),
      recordPrimaryFailure,
      executeFallback,
      mafPrimaryRuntime: createPrimaryRuntime(client),
    });

    await expect(router.processMessage(PRIMARY_REQUEST)).rejects.toThrow(expectedDiagnostic.reasonCode);

    expect(recordPrimaryFailure).toHaveBeenCalledWith({
      request: PRIMARY_REQUEST,
      decision: {
        mode: 'maf_primary',
        decisionSource: 'primary_flag',
      },
      diagnostic: expectedDiagnostic,
      runtimeAttemptId: 'attempt-1',
    });
    expect(executeFallback).not.toHaveBeenCalled();
    expect(typescriptRuntime.processMessage).not.toHaveBeenCalled();
  });

  it('fails closed through the primary adapter before candidate execution when strict boundary fields are missing', async () => {
    const incompleteRequest: ProcessMessageRequest = {
      ...PRIMARY_REQUEST,
      requestId: undefined,
      eventId: undefined,
      runtimeAttempt: undefined,
    };
    const typescriptRuntime = {
      processMessage: vi.fn().mockResolvedValue(RESULT),
    } as unknown as TypeScriptAgentRuntime;
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => CANDIDATE_RESULT,
    }));
    const client = new MafAgentRuntimeClient({
      serviceUrl: 'http://127.0.0.1:8001',
      fetch: fetchImpl,
    });
    const recordPrimaryFailure = vi.fn(async () => undefined);
    const router = new AgentRuntimeRouter(typescriptRuntime, {
      evaluateMode: () => ({ mode: 'maf_primary', decisionSource: 'primary_flag' }),
      recordPrimaryFailure,
      mafPrimaryRuntime: createPrimaryRuntime(client),
    });

    await expect(router.processMessage(incompleteRequest)).rejects.toThrow('maf_runtime_boundary_request_invalid');

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(recordPrimaryFailure).toHaveBeenCalledWith({
      request: incompleteRequest,
      decision: {
        mode: 'maf_primary',
        decisionSource: 'primary_flag',
      },
      diagnostic: {
        reasonCode: 'maf_runtime_boundary_request_invalid',
        invalidFields: ['requestId', 'eventId', 'runtimeAttempt'],
      },
    });
    expect(typescriptRuntime.processMessage).not.toHaveBeenCalled();
  });

  it('fails closed through the primary adapter when the MAF request times out before commit', async () => {
    vi.useFakeTimers();
    try {
      const typescriptRuntime = {
        processMessage: vi.fn().mockResolvedValue(RESULT),
      } as unknown as TypeScriptAgentRuntime;
      const client = new MafAgentRuntimeClient({
        serviceUrl: 'http://127.0.0.1:8001',
        timeoutMs: 5,
        fetch: vi.fn((_input, init) => new Promise((_resolve, reject) => {
          const signal = init?.signal as AbortSignal | undefined;
          signal?.addEventListener('abort', () => reject(new Error('aborted')));
        })),
      });
      const recordPrimaryFailure = vi.fn(async () => undefined);
      const executeFallback = vi.fn(async <T>(
        _request: ProcessMessageRequest,
        fallback: () => Promise<T> | T,
      ): Promise<T> => fallback()) as AgentRuntimeFallbackExecutor;
      const router = new AgentRuntimeRouter(typescriptRuntime, {
        evaluateMode: () => ({ mode: 'maf_primary', decisionSource: 'primary_flag' }),
        recordDecision: vi.fn(async () => ({ runtimeAttemptId: 'attempt-1' })),
        recordPrimaryFailure,
        executeFallback,
        mafPrimaryRuntime: createPrimaryRuntime(client),
      });

      const result = router.processMessage(PRIMARY_REQUEST);
      const expectation = expect(result).rejects.toThrow('maf_runtime_fetch_failed');
      await vi.advanceTimersByTimeAsync(5);

      await expectation;
      expect(recordPrimaryFailure).toHaveBeenCalledWith({
        request: PRIMARY_REQUEST,
        decision: {
          mode: 'maf_primary',
          decisionSource: 'primary_flag',
        },
        diagnostic: {
          reasonCode: 'maf_runtime_fetch_failed',
        },
        runtimeAttemptId: 'attempt-1',
      });
      expect(executeFallback).not.toHaveBeenCalled();
      expect(typescriptRuntime.processMessage).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('executes TypeScript fallback directly when no fallback guard is configured', async () => {
    const typescriptRuntime = {
      processMessage: vi.fn().mockResolvedValue(RESULT),
    } as unknown as TypeScriptAgentRuntime;
    const fallback = vi.fn().mockResolvedValue(RESULT);
    const router = new AgentRuntimeRouter(typescriptRuntime);

    await expect(router.executeTypeScriptFallback(REQUEST, fallback)).resolves.toBe(RESULT);

    expect(fallback).toHaveBeenCalledTimes(1);
  });

  it('routes future TypeScript fallback through the configured fallback guard', async () => {
    const typescriptRuntime = {
      processMessage: vi.fn().mockResolvedValue(RESULT),
    } as unknown as TypeScriptAgentRuntime;
    const fallback = vi.fn().mockResolvedValue(RESULT);
    const executeFallback = vi.fn().mockRejectedValue(new Error('fallback_closed_after_actions_committed'));
    const router = new AgentRuntimeRouter(typescriptRuntime, {
      executeFallback,
    });

    await expect(router.executeTypeScriptFallback(REQUEST, fallback)).rejects.toThrow(
      'fallback_closed_after_actions_committed',
    );

    expect(executeFallback).toHaveBeenCalledWith(REQUEST, fallback);
    expect(fallback).not.toHaveBeenCalled();
  });

  it.each([
    ['typescript', 'typescript_default'],
    ['maf_disabled', 'global_kill_switch'],
    ['maf_shadow', 'shadow_flag'],
    ['maf_canary', 'canary_flag'],
  ] as const)('logs a structured runtime decision for %s mode', async (mode, decisionSource) => {
    const typescriptRuntime = {
      processMessage: vi.fn().mockResolvedValue(RESULT),
    } as unknown as TypeScriptAgentRuntime;
    const logger = { info: vi.fn(), warn: vi.fn() };
    const router = new AgentRuntimeRouter(typescriptRuntime, {
      evaluateMode: () => ({ mode, decisionSource }),
      logger,
    });

    await expect(router.processMessage(REQUEST)).resolves.toBe(RESULT);

    expect(logger.info).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith('Agent runtime decision resolved', {
      traceId: 'trace-1',
      tenantId: 'tenant-1',
      userId: 'user-1',
      mode,
      decisionSource,
    });
    expect(typescriptRuntime.processMessage).toHaveBeenCalledWith(REQUEST);
  });

  it('keeps runtime decision payload limited to non-content fields', async () => {
    const typescriptRuntime = {
      processMessage: vi.fn().mockResolvedValue(RESULT),
    } as unknown as TypeScriptAgentRuntime;
    const logger = { info: vi.fn(), warn: vi.fn() };
    const router = new AgentRuntimeRouter(typescriptRuntime, {
      evaluateMode: () => ({ mode: 'maf_shadow', decisionSource: 'shadow_flag' }),
      logger,
    });

    await router.processMessage(REQUEST);

    const payload = logger.info.mock.calls[0]?.[1];
    expect(payload).toBeDefined();
    expect(Object.keys(payload).sort()).toEqual([
      'decisionSource',
      'mode',
      'tenantId',
      'traceId',
      'userId',
    ]);
    expect(payload).not.toHaveProperty('conversationId');
    expect(payload).not.toHaveProperty('externalConversationId');
    expect(payload).not.toHaveProperty('externalWorkspaceId');
    expect(payload).not.toHaveProperty('messageId');
    expect(payload).not.toHaveProperty('responseText');
    expect(payload).not.toHaveProperty('classification');
    expect(payload).not.toHaveProperty('risk');
  });

  it('keeps fallback decision and warning payloads limited to non-content fields', async () => {
    const typescriptRuntime = {
      processMessage: vi.fn().mockResolvedValue(RESULT),
    } as unknown as TypeScriptAgentRuntime;
    const logger = { info: vi.fn(), warn: vi.fn() };
    const router = new AgentRuntimeRouter(typescriptRuntime, {
      evaluateMode: () => {
        throw new Error('raw user text: hello from message');
      },
      logger,
    });

    await router.processMessage(REQUEST);

    const decisionPayload = logger.info.mock.calls[0]?.[1];
    const warningPayload = logger.warn.mock.calls[0]?.[1];
    expect(decisionPayload).toEqual({
      traceId: 'trace-1',
      tenantId: 'tenant-1',
      userId: 'user-1',
      mode: 'typescript',
      decisionSource: 'evaluation_failure',
      fallbackReason: 'runtime_mode_evaluation_failed',
    });
    expect(warningPayload).toEqual({
      traceId: 'trace-1',
      fallbackReason: 'runtime_mode_evaluation_failed',
    });
    expect(JSON.stringify(decisionPayload)).not.toContain('hello from message');
    expect(JSON.stringify(warningPayload)).not.toContain('hello from message');
  });

  it.each([
    null,
    undefined,
    {},
    { mode: 'maf_shadow' },
    { decisionSource: 'shadow_flag' },
    { mode: 'invalid_mode', decisionSource: 'shadow_flag' },
    { mode: 'maf_shadow', decisionSource: 'invalid_source' },
  ])('fails closed when the evaluator returns a malformed decision: %j', async (malformedDecision) => {
    const typescriptRuntime = {
      processMessage: vi.fn().mockResolvedValue(RESULT),
    } as unknown as TypeScriptAgentRuntime;
    const logger = { info: vi.fn(), warn: vi.fn() };
    const router = new AgentRuntimeRouter(typescriptRuntime, {
      evaluateMode: () => malformedDecision as never,
      logger,
    });

    await expect(router.processMessage(REQUEST)).resolves.toBe(RESULT);

    expect(logger.info).toHaveBeenCalledWith('Agent runtime decision resolved', {
      traceId: 'trace-1',
      tenantId: 'tenant-1',
      userId: 'user-1',
      mode: 'typescript',
      decisionSource: 'evaluation_failure',
      fallbackReason: 'runtime_mode_evaluation_failed',
    });
    expect(typescriptRuntime.processMessage).toHaveBeenCalledWith(REQUEST);
  });

  it('still delegates when runtime decision logging throws', async () => {
    const typescriptRuntime = {
      processMessage: vi.fn().mockResolvedValue(RESULT),
    } as unknown as TypeScriptAgentRuntime;
    const router = new AgentRuntimeRouter(typescriptRuntime, {
      evaluateMode: () => ({ mode: 'maf_shadow', decisionSource: 'shadow_flag' }),
      logger: {
        info: () => {
          throw new Error('logger unavailable');
        },
        warn: vi.fn(),
      },
    });

    await expect(router.processMessage(REQUEST)).resolves.toBe(RESULT);

    expect(typescriptRuntime.processMessage).toHaveBeenCalledTimes(1);
    expect(typescriptRuntime.processMessage).toHaveBeenCalledWith(REQUEST);
  });

  it.each([
    ['maf_disabled', 'global_kill_switch'],
    ['maf_shadow', 'shadow_flag'],
    ['maf_canary', 'canary_flag'],
  ] as const)('maps legacy %s evaluator results to a decision source', async (mode, decisionSource) => {
    const typescriptRuntime = {
      processMessage: vi.fn().mockResolvedValue(RESULT),
    } as unknown as TypeScriptAgentRuntime;
    const logger = { info: vi.fn(), warn: vi.fn() };
    const router = new AgentRuntimeRouter(typescriptRuntime, {
      evaluateMode: () => mode as AgentRuntimeMode,
      logger,
    });

    await router.processMessage(REQUEST);

    expect(logger.info).toHaveBeenCalledWith('Agent runtime decision resolved', expect.objectContaining({
      mode,
      decisionSource,
    }));
  });

  it('records the resolved runtime decision before delegating to the TypeScript runtime', async () => {
    const callOrder: string[] = [];
    const typescriptRuntime = {
      processMessage: vi.fn(async () => {
        callOrder.push('runtime');
        return RESULT;
      }),
    } as unknown as TypeScriptAgentRuntime;
    const recordDecision = vi.fn(async () => {
      callOrder.push('ledger');
    });
    const router = new AgentRuntimeRouter(typescriptRuntime, {
      evaluateMode: () => ({ mode: 'maf_shadow', decisionSource: 'shadow_flag' }),
      recordDecision,
    });

    await expect(router.processMessage(REQUEST)).resolves.toBe(RESULT);

    expect(recordDecision).toHaveBeenCalledWith(REQUEST, {
      mode: 'maf_shadow',
      decisionSource: 'shadow_flag',
    });
    expect(callOrder).toEqual(['ledger', 'runtime']);
  });

  it('records runtime failure after a started decision has been persisted', async () => {
    const runtimeError = new Error('runtime failed');
    const typescriptRuntime = {
      processMessage: vi.fn().mockRejectedValue(runtimeError),
    } as unknown as TypeScriptAgentRuntime;
    const recordDecision = vi.fn(async () => undefined);
    const recordFailure = vi.fn(async () => undefined);
    const router = new AgentRuntimeRouter(typescriptRuntime, {
      evaluateMode: () => ({ mode: 'maf_shadow', decisionSource: 'shadow_flag' }),
      recordDecision,
      recordFailure,
    });

    await expect(router.processMessage(REQUEST)).rejects.toThrow(runtimeError);

    expect(recordDecision).toHaveBeenCalledTimes(1);
    expect(recordFailure).toHaveBeenCalledWith(
      REQUEST,
      {
        mode: 'maf_shadow',
        decisionSource: 'shadow_flag',
      },
      runtimeError,
    );
  });

  it('runs a MAF candidate only in shadow mode and records valid shadow diagnostics after returning the TypeScript result', async () => {
    const callOrder: string[] = [];
    const typescriptRuntime = {
      processMessage: vi.fn(async () => {
        callOrder.push('typescript');
        return RESULT;
      }),
    } as unknown as TypeScriptAgentRuntime;
    const mafRuntime = {
      getConfigurationDiagnostic: vi.fn(() => null),
      processCandidate: vi.fn(async () => {
        callOrder.push('candidate');
        return CANDIDATE_RESULT;
      }),
    };
    const recordDecision = vi.fn(async () => {
      callOrder.push('ledger');
      return { runtimeAttemptId: 'attempt-1' };
    });
    const recordShadowCandidate = vi.fn(async () => {
      callOrder.push('shadow-diagnostics');
    });
    const router = new AgentRuntimeRouter(typescriptRuntime, {
      evaluateMode: () => ({ mode: 'maf_shadow', decisionSource: 'shadow_flag' }),
      mafRuntime,
      recordDecision,
      recordShadowCandidate,
    });

    await expect(router.processMessage(REQUEST)).resolves.toBe(RESULT);

    expect(callOrder).toEqual(['ledger', 'typescript', 'candidate', 'shadow-diagnostics']);
    expect(mafRuntime.processCandidate).toHaveBeenCalledWith(REQUEST);
    expect(recordShadowCandidate).toHaveBeenCalledWith({
      request: REQUEST,
      decision: {
        mode: 'maf_shadow',
        decisionSource: 'shadow_flag',
      },
      runtimeAttemptId: 'attempt-1',
      currentResult: RESULT,
      candidateResult: CANDIDATE_RESULT,
      validationStatus: 'valid',
    });
  });

  it('records invalid shadow diagnostics and still returns the TypeScript result when the candidate fails validation', async () => {
    const candidateError = new Error('raw response body with bearer token');
    Object.assign(candidateError, {
      safeDiagnostic: {
        reasonCode: 'maf_runtime_response_invalid',
        invalidFields: ['$.diagnostics.retryCount'],
      },
    });
    const typescriptRuntime = {
      processMessage: vi.fn().mockResolvedValue(RESULT),
    } as unknown as TypeScriptAgentRuntime;
    const mafRuntime = {
      getConfigurationDiagnostic: vi.fn(() => null),
      processCandidate: vi.fn().mockRejectedValue(candidateError),
    };
    const recordShadowCandidate = vi.fn(async () => undefined);
    const logger = { info: vi.fn(), warn: vi.fn() };
    const router = new AgentRuntimeRouter(typescriptRuntime, {
      evaluateMode: () => ({ mode: 'maf_shadow', decisionSource: 'shadow_flag' }),
      mafRuntime,
      recordShadowCandidate,
      logger,
    });

    await expect(router.processMessage(REQUEST)).resolves.toBe(RESULT);

    expect(recordShadowCandidate).toHaveBeenCalledWith({
      request: REQUEST,
      decision: {
        mode: 'maf_shadow',
        decisionSource: 'shadow_flag',
      },
      currentResult: RESULT,
      validationStatus: 'invalid',
      diagnostic: {
        reasonCode: 'maf_runtime_response_invalid',
        invalidFields: ['$.diagnostics.retryCount'],
      },
    });
    const firstShadowRecord = (recordShadowCandidate.mock.calls as unknown as [
      { diagnostic?: unknown },
    ][])[0]?.[0];
    const diagnostic = JSON.stringify(firstShadowRecord?.diagnostic);
    expect(diagnostic).not.toContain('raw response body');
    expect(diagnostic).not.toContain('bearer token');
    expect(logger.warn).toHaveBeenCalledWith('MAF shadow candidate failed; TypeScript result remains user-facing', {
      traceId: 'trace-1',
      mode: 'maf_shadow',
      decisionSource: 'shadow_flag',
      fallbackReason: 'maf_runtime_response_invalid',
    });
  });

  it('does not call a permissive MAF shadow provider when strict boundary fields are missing', async () => {
    const incompleteRequest: ProcessMessageRequest = {
      ...REQUEST,
      requestId: undefined,
      eventId: undefined,
      runtimeAttempt: undefined,
    };
    const typescriptRuntime = {
      processMessage: vi.fn().mockResolvedValue(RESULT),
    } as unknown as TypeScriptAgentRuntime;
    const mafRuntime = {
      getConfigurationDiagnostic: vi.fn(() => null),
      processCandidate: vi.fn(async () => CANDIDATE_RESULT),
    };
    const recordShadowCandidate = vi.fn(async () => undefined);
    const router = new AgentRuntimeRouter(typescriptRuntime, {
      evaluateMode: () => ({ mode: 'maf_shadow', decisionSource: 'shadow_flag' }),
      mafRuntime,
      recordShadowCandidate,
    });

    await expect(router.processMessage(incompleteRequest)).resolves.toBe(RESULT);

    expect(mafRuntime.processCandidate).not.toHaveBeenCalled();
    expect(recordShadowCandidate).toHaveBeenCalledWith({
      request: incompleteRequest,
      decision: {
        mode: 'maf_shadow',
        decisionSource: 'shadow_flag',
      },
      currentResult: RESULT,
      validationStatus: 'invalid',
      diagnostic: {
        reasonCode: 'maf_runtime_boundary_request_invalid',
        invalidFields: ['requestId', 'eventId', 'runtimeAttempt'],
      },
    });
  });

  it('records safe boundary diagnostics for malformed non-string request identifiers', async () => {
    const malformedRequest = {
      ...REQUEST,
      requestId: 42,
    } as unknown as ProcessMessageRequest;
    const typescriptRuntime = {
      processMessage: vi.fn().mockResolvedValue(RESULT),
    } as unknown as TypeScriptAgentRuntime;
    const mafRuntime = {
      getConfigurationDiagnostic: vi.fn(() => null),
      processCandidate: vi.fn(async () => CANDIDATE_RESULT),
    };
    const recordShadowCandidate = vi.fn(async () => undefined);
    const router = new AgentRuntimeRouter(typescriptRuntime, {
      evaluateMode: () => ({ mode: 'maf_shadow', decisionSource: 'shadow_flag' }),
      mafRuntime,
      recordShadowCandidate,
    });

    await expect(router.processMessage(malformedRequest)).resolves.toBe(RESULT);

    expect(mafRuntime.processCandidate).not.toHaveBeenCalled();
    expect(recordShadowCandidate).toHaveBeenCalledWith(expect.objectContaining({
      validationStatus: 'invalid',
      diagnostic: {
        reasonCode: 'maf_runtime_boundary_request_invalid',
        invalidFields: ['requestId'],
      },
    }));
  });

  it('leaves traceId validation to the MAF client instead of the strict boundary guard', async () => {
    const requestWithMissingTrace: ProcessMessageRequest = {
      ...REQUEST,
      traceId: '',
    };
    const typescriptRuntime = {
      processMessage: vi.fn().mockResolvedValue(RESULT),
    } as unknown as TypeScriptAgentRuntime;
    const mafRuntime = {
      getConfigurationDiagnostic: vi.fn(() => null),
      processCandidate: vi.fn(async () => CANDIDATE_RESULT),
    };
    const recordShadowCandidate = vi.fn(async () => undefined);
    const router = new AgentRuntimeRouter(typescriptRuntime, {
      evaluateMode: () => ({ mode: 'maf_shadow', decisionSource: 'shadow_flag' }),
      mafRuntime,
      recordShadowCandidate,
    });

    await expect(router.processMessage(requestWithMissingTrace)).resolves.toBe(RESULT);

    expect(mafRuntime.processCandidate).toHaveBeenCalledWith(requestWithMissingTrace);
  });

  it('routes maf_canary through the primary MAF adapter and keeps it user-facing', async () => {
    const primaryResult: ProcessMessageResult = {
      ...RESULT,
      outboundMessageId: 'canary-out-1',
      responseText: 'canary primary reply',
    };
    const typescriptRuntime = {
      processMessage: vi.fn().mockResolvedValue(RESULT),
    } as unknown as TypeScriptAgentRuntime;
    const mafPrimaryRuntime = {
      processMessage: vi.fn().mockResolvedValue(primaryResult),
    };
    const recordDecision = vi.fn(async () => ({ runtimeAttemptId: 'attempt-1' }));
    const recordPrimarySuccess = vi.fn(async () => undefined);
    const router = new AgentRuntimeRouter(typescriptRuntime, {
      evaluateMode: () => ({ mode: 'maf_canary', decisionSource: 'canary_flag' }),
      mafRuntime: {
        getConfigurationDiagnostic: vi.fn(() => null),
      },
      mafPrimaryRuntime,
      recordDecision,
      recordPrimarySuccess,
    });

    await expect(router.processMessage(REQUEST)).resolves.toEqual(primaryResult);

    expect(mafPrimaryRuntime.processMessage).toHaveBeenCalledWith(REQUEST);
    expect(recordDecision).toHaveBeenCalledWith(REQUEST, {
      mode: 'maf_canary',
      decisionSource: 'canary_flag',
    });
    expect(recordPrimarySuccess).toHaveBeenCalledWith({
      request: REQUEST,
      decision: {
        mode: 'maf_canary',
        decisionSource: 'canary_flag',
      },
      runtimeAttemptId: 'attempt-1',
    });
    expect(typescriptRuntime.processMessage).not.toHaveBeenCalled();
  });

  it('falls back to TypeScript when maf_canary fails before commit with a safe diagnostic', async () => {
    const primaryError = new Error('provider failed');
    Object.assign(primaryError, {
      safeDiagnostic: {
        reasonCode: 'maf_runtime_fetch_failed',
      },
    });
    const typescriptRuntime = {
      processMessage: vi.fn().mockResolvedValue(RESULT),
    } as unknown as TypeScriptAgentRuntime;
    const mafPrimaryRuntime = {
      processMessage: vi.fn().mockRejectedValue(primaryError),
    };
    const recordDecision = vi.fn(async () => ({ runtimeAttemptId: 'attempt-1' }));
    const recordPrimaryFailure = vi.fn(async () => undefined);
    const executeFallback = vi.fn(async <T>(_request: ProcessMessageRequest, fallback: () => Promise<T> | T) =>
      fallback(),
    ) as AgentRuntimeFallbackExecutor;
    const logger = { info: vi.fn(), warn: vi.fn() };
    const router = new AgentRuntimeRouter(typescriptRuntime, {
      evaluateMode: () => ({ mode: 'maf_canary', decisionSource: 'canary_flag' }),
      recordDecision,
      recordPrimaryFailure,
      executeFallback,
      mafRuntime: {
        getConfigurationDiagnostic: vi.fn(() => null),
      },
      mafPrimaryRuntime,
      logger,
    });

    await expect(router.processMessage(REQUEST)).resolves.toBe(RESULT);

    expect(mafPrimaryRuntime.processMessage).toHaveBeenCalledWith(REQUEST);
    expect(recordPrimaryFailure).toHaveBeenCalledWith({
      request: REQUEST,
      decision: {
        mode: 'maf_canary',
        decisionSource: 'canary_flag',
      },
      diagnostic: {
        reasonCode: 'maf_runtime_fetch_failed',
      },
      runtimeAttemptId: 'attempt-1',
    });
    expect(executeFallback).toHaveBeenCalledWith(REQUEST, expect.any(Function));
    expect(logger.warn).toHaveBeenCalledWith('MAF primary failed before commit; falling back to TypeScript runtime', {
      traceId: 'trace-1',
      mode: 'maf_canary',
      decisionSource: 'canary_flag',
      fallbackReason: 'maf_runtime_fetch_failed',
    });
    expect(typescriptRuntime.processMessage).toHaveBeenCalledWith(REQUEST);
  });

  it('still uses candidate diagnostics only for maf_shadow mode', async () => {
    const typescriptRuntime = {
      processMessage: vi.fn().mockResolvedValue(RESULT),
    } as unknown as TypeScriptAgentRuntime;
    const mafRuntime = {
      getConfigurationDiagnostic: vi.fn(() => null),
      processCandidate: vi.fn().mockResolvedValue(CANDIDATE_RESULT),
    };
    const recordShadowCandidate = vi.fn(async () => undefined);
    const router = new AgentRuntimeRouter(typescriptRuntime, {
      evaluateMode: () => ({ mode: 'maf_shadow', decisionSource: 'shadow_flag' }),
      mafRuntime,
      recordShadowCandidate,
    });

    await expect(router.processMessage(REQUEST)).resolves.toBe(RESULT);

    expect(mafRuntime.processCandidate).toHaveBeenCalledWith(REQUEST);
    expect(recordShadowCandidate).toHaveBeenCalled();
    expect(typescriptRuntime.processMessage).toHaveBeenCalledWith(REQUEST);
  });

  it.each(['maf_shadow', 'maf_canary'] as const)(
    'fails closed to TypeScript and records a configuration diagnostic for missing MAF config in %s mode',
    async (mode) => {
      const typescriptRuntime = {
        processMessage: vi.fn().mockResolvedValue(RESULT),
      } as unknown as TypeScriptAgentRuntime;
      const recordConfigurationDiagnostic = vi.fn(async () => undefined);
      const mafRuntime = new MafAgentRuntimeClient({ fetch: vi.fn() });
      const router = new AgentRuntimeRouter(typescriptRuntime, {
        evaluateMode: () => ({ mode, decisionSource: mode === 'maf_shadow' ? 'shadow_flag' : 'canary_flag' }),
        mafRuntime,
        recordConfigurationDiagnostic,
      });

      await expect(router.processMessage(REQUEST)).resolves.toBe(RESULT);

      expect(typescriptRuntime.processMessage).toHaveBeenCalledWith(REQUEST);
      expect(recordConfigurationDiagnostic).toHaveBeenCalledWith({
        mode,
        decisionSource: mode === 'maf_shadow' ? 'shadow_flag' : 'canary_flag',
        reasonCode: 'maf_runtime_configuration_missing',
        missingConfigKeys: ['AGENT_SERVICE_INTERNAL_URL'],
      });
    },
  );

  it('records a redacted MAF boundary diagnostic before delegating to TypeScript', async () => {
    const typescriptRuntime = {
      processMessage: vi.fn().mockResolvedValue(RESULT),
    } as unknown as TypeScriptAgentRuntime;
    const recordConfigurationDiagnostic = vi.fn(async () => undefined);
    const logger = { info: vi.fn(), warn: vi.fn() };
    const mafRuntime = new MafAgentRuntimeClient({
      serviceUrl: 'https://agent-service.internal',
      serviceAuthSecret: 'super-secret-service-auth-token',
      fetch: vi.fn(),
    });
    const requestWithRawFields = {
      ...REQUEST,
      requestId: '',
      externalConversationId: 'raw-channel',
      externalWorkspaceId: 'raw-workspace',
    };
    const router = new AgentRuntimeRouter(typescriptRuntime, {
      evaluateMode: () => ({ mode: 'maf_shadow', decisionSource: 'shadow_flag' }),
      mafRuntime,
      recordConfigurationDiagnostic,
      logger,
    });

    await expect(router.processMessage(requestWithRawFields)).resolves.toBe(RESULT);

    const diagnostic = (recordConfigurationDiagnostic.mock.calls as unknown as [
      AgentRuntimeConfigurationDiagnostic,
    ][])[0]?.[0];
    expect(diagnostic).toEqual({
      mode: 'maf_shadow',
      decisionSource: 'shadow_flag',
      reasonCode: 'maf_runtime_boundary_request_invalid',
      invalidFields: ['requestId'],
    });
    expect(JSON.stringify(diagnostic)).not.toContain('super-secret-service-auth-token');
    expect(JSON.stringify(diagnostic)).not.toContain('raw-channel');
    expect(JSON.stringify(diagnostic)).not.toContain('raw-workspace');
    expect(logger.warn).toHaveBeenCalledWith('MAF runtime unavailable; falling back to TypeScript runtime', {
      traceId: 'trace-1',
      mode: 'maf_shadow',
      decisionSource: 'shadow_flag',
      fallbackReason: 'maf_runtime_boundary_request_invalid',
    });
    expect(typescriptRuntime.processMessage).toHaveBeenCalledWith(requestWithRawFields);
  });

  it('still fails closed when the MAF diagnostic provider throws', async () => {
    const typescriptRuntime = {
      processMessage: vi.fn().mockResolvedValue(RESULT),
    } as unknown as TypeScriptAgentRuntime;
    const recordConfigurationDiagnostic = vi.fn(async () => undefined);
    const router = new AgentRuntimeRouter(typescriptRuntime, {
      evaluateMode: () => ({ mode: 'maf_shadow', decisionSource: 'shadow_flag' }),
      mafRuntime: {
        getConfigurationDiagnostic: () => {
          throw new Error('raw provider failure');
        },
      },
      recordConfigurationDiagnostic,
    });

    await expect(router.processMessage(REQUEST)).resolves.toBe(RESULT);

    expect(recordConfigurationDiagnostic).toHaveBeenCalledWith({
      mode: 'maf_shadow',
      decisionSource: 'shadow_flag',
      reasonCode: 'maf_runtime_configuration_invalid',
      invalidConfigKeys: ['AGENT_SERVICE_INTERNAL_URL'],
    });
    expect(typescriptRuntime.processMessage).toHaveBeenCalledWith(REQUEST);
  });

  it('still fails closed when recording the MAF diagnostic throws', async () => {
    const typescriptRuntime = {
      processMessage: vi.fn().mockResolvedValue(RESULT),
    } as unknown as TypeScriptAgentRuntime;
    const router = new AgentRuntimeRouter(typescriptRuntime, {
      evaluateMode: () => ({ mode: 'maf_shadow', decisionSource: 'shadow_flag' }),
      mafRuntime: new MafAgentRuntimeClient({ fetch: vi.fn() }),
      recordConfigurationDiagnostic: () => {
        throw new Error('diagnostic sink unavailable');
      },
    });

    await expect(router.processMessage(REQUEST)).resolves.toBe(RESULT);

    expect(typescriptRuntime.processMessage).toHaveBeenCalledWith(REQUEST);
  });
});

function createPrimaryRuntime(client: MafAgentRuntimeClient): MafPrimaryAgentRuntime {
  return new MafPrimaryAgentRuntime(
    {
      findById: vi.fn(async () => ({
        id: PRIMARY_REQUEST.conversationId,
        tenantId: PRIMARY_REQUEST.tenantId,
        userId: PRIMARY_REQUEST.userId,
        channelType: 'slack',
        externalConversationId: PRIMARY_REQUEST.externalConversationId,
        status: 'active',
        userTimezone: 'UTC',
        userTimezoneUpdatedAt: new Date(),
      })),
      findRecentMessages: vi.fn(async () => []),
      findLatestDeliveredReportingDisclosure: vi.fn(async () => null),
      saveMessage: vi.fn(async (params) => ({
        id: 'primary-outbound-1',
        ...params,
        occurredAt: params.occurredAt ?? new Date(),
        createdAt: new Date(),
      })),
      updateMessageDelivery: vi.fn(async () => new Date()),
    },
    {
      enqueueMessageSend: vi.fn(async () => undefined),
      enqueueMemoryExtraction: vi.fn(async () => undefined),
      enqueueFollowUpExecution: vi.fn(async () => undefined),
      enqueueSurveyEvidence: vi.fn(async () => undefined),
      enqueueGroupReport: vi.fn(async () => undefined),
      enqueueStyleAnalysis: vi.fn(async () => undefined),
      enqueueProfileHydration: vi.fn(async () => undefined),
    },
    client,
    { isEnabled: vi.fn(async () => true) },
  );
}
