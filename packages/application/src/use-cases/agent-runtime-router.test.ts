import { describe, expect, it, vi } from 'vitest';
import type { ProcessMessageRequest, ProcessMessageResult } from '../ports/agent-runtime.port';
import { AgentRuntimeRouter } from './agent-runtime-router';
import type { AgentRuntimeMode } from './agent-runtime-router';
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
});
