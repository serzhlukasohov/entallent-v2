import { describe, expect, it, vi } from 'vitest';
import type { ProcessMessageRequest, ProcessMessageResult } from '../ports/agent-runtime.port';
import { AgentRuntimeRouter } from './agent-runtime-router';
import type { TypeScriptAgentRuntime } from './typescript-agent-runtime';

const REQUEST: ProcessMessageRequest = {
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
    const logger = { warn: vi.fn() };
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
      expect.objectContaining({ traceId: 'trace-1' }),
    );
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
});
