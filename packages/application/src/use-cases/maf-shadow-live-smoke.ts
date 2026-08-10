import type { MafAgentRuntimeFetch } from './maf-agent-runtime-client';
import { MafAgentRuntimeClient } from './maf-agent-runtime-client';
import { runMafShadowLocalValidation } from './maf-shadow-local-validation';
import type { MafShadowLocalValidationEvidence } from './maf-shadow-local-validation';
import type { ProcessMessageRequest, ProcessMessageResult } from '../ports/agent-runtime.port';
import type { TypeScriptAgentRuntime } from './typescript-agent-runtime';

export type MafShadowLiveSmokeStatus = 'valid' | 'invalid' | 'configuration_missing';
export type MafShadowLiveSmokeValidationStatus = 'contract_valid' | 'contract_invalid' | 'not_run';
export type MafShadowLiveSmokeProvider = 'openai' | 'azure_openai';

export interface MafShadowLiveSmokeOptions {
  serviceUrl: string;
  timeoutMs?: number;
  fetch?: MafAgentRuntimeFetch;
  request?: ProcessMessageRequest;
  currentResult?: ProcessMessageResult;
}

export interface MafShadowLiveSmokeEvidence {
  status: MafShadowLiveSmokeStatus;
  validationStatus: MafShadowLiveSmokeValidationStatus;
  traceId?: string;
  failureReason?: string;
  userFacing?: MafShadowLocalValidationEvidence['userFacing'];
  shadow?: MafShadowLocalValidationEvidence['shadow'];
}

export interface MafShadowLiveSmokeEnvResolution {
  provider?: MafShadowLiveSmokeProvider;
  modelNameConfigured: boolean;
  env: Record<string, string>;
  missingConfigKeys: string[];
  invalidConfigKeys?: string[];
}

const DEFAULT_LIVE_SHADOW_REQUEST: ProcessMessageRequest = {
  requestId: '11111111-1111-4111-8111-111111111111',
  eventId: '22222222-2222-4222-8222-222222222222',
  runtimeAttempt: 1,
  messageId: '33333333-3333-4333-8333-333333333333',
  conversationId: '44444444-4444-4444-8444-444444444444',
  userId: '33333333-3333-4333-8333-333333333333',
  tenantId: 'tenant-demo',
  externalWorkspaceId: 'workspace-demo',
  externalConversationId: 'conversation-demo',
  traceId: 'trace-runtime-contract-valid-request',
  messageText: 'Synthetic message for runtime contract validation.',
  messageCreatedAt: '2026-08-05T11:58:01Z',
  userDisplayName: 'Synthetic User',
  userTimezone: 'UTC',
  userLocale: 'en',
  conversationSessionKey: 'workspace-demo:user-demo:conversation-demo:thread-demo',
  conversationThreadId: 'thread-demo',
  runtimeContext: {
    recentTurns: [
      {
        role: 'user',
        content: 'Synthetic previous user message.',
        timestamp: '2026-08-05T11:57:01Z',
      },
      {
        role: 'assistant',
        content: 'Synthetic previous assistant response.',
        timestamp: '2026-08-05T11:57:20Z',
      },
    ],
    memoryItems: [
      {
        id: '66666666-6666-4666-8666-666666666666',
        category: 'preference',
        content: 'Synthetic memory content.',
        importance: 0.5,
      },
    ],
    goals: [
      {
        id: '77777777-7777-4777-8777-777777777777',
        title: 'Synthetic goal',
        status: 'active',
      },
    ],
  },
};

const DEFAULT_TYPESCRIPT_RESULT: ProcessMessageResult = {
  outboundMessageId: 'typescript-live-shadow-smoke',
  responseText: 'TypeScript user-facing smoke reply.',
  mode: 'normal',
  classification: {
    primaryIntent: 'casual_conversation',
    secondaryIntents: [],
    emotionalState: [],
    urgency: 'low',
    confidence: 0.9,
    requiresSafetyCheck: false,
    surveyAllowed: true,
    reasoningSummary: 'Local smoke classification.',
    reminderRequest: null,
    dialogueAct: 'new_substance',
    latestUserSubstance: 'Synthetic message for runtime contract validation.',
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
    reasoningSummary: 'No risk in local smoke request.',
  },
};

export async function runMafShadowLiveSmoke(
  options: MafShadowLiveSmokeOptions,
): Promise<MafShadowLiveSmokeEvidence> {
  const localEvidence = await runMafShadowLocalValidation({
    request: options.request ?? DEFAULT_LIVE_SHADOW_REQUEST,
    currentRuntime: runtimeResolving(options.currentResult ?? DEFAULT_TYPESCRIPT_RESULT),
    mafRuntime: new MafAgentRuntimeClient({
      serviceUrl: options.serviceUrl,
      ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
      ...(options.fetch ? { fetch: options.fetch } : {}),
    }),
    runtimeAttemptId: 'live-shadow-smoke-attempt',
  });

  if (localEvidence.validationStatus !== 'valid') {
    return {
      status: 'invalid',
      validationStatus: 'contract_invalid',
      traceId: localEvidence.traceId,
      failureReason: localEvidence.shadow.diagnostic?.reasonCode ?? 'shadow_candidate_invalid',
      userFacing: localEvidence.userFacing,
      shadow: localEvidence.shadow,
    };
  }

  if (localEvidence.shadow.modelCalls !== 1) {
    return {
      status: 'invalid',
      validationStatus: 'contract_valid',
      traceId: localEvidence.traceId,
      failureReason: 'model_call_count_invalid',
      userFacing: localEvidence.userFacing,
      shadow: localEvidence.shadow,
    };
  }

  return {
    status: 'valid',
    validationStatus: 'contract_valid',
    traceId: localEvidence.traceId,
    userFacing: localEvidence.userFacing,
    shadow: localEvidence.shadow,
  };
}

export function resolveMafShadowLiveSmokeEnv(
  env: Record<string, string | undefined>,
): MafShadowLiveSmokeEnvResolution {
  const providerConfig = resolveProvider(env);
  const modelName = normalized(
    env.AGENT_SERVICE_MODEL_NAME
      ?? env.OPENAI_MODEL_BALANCED
      ?? env.OPENAI_MODEL_GENERATION
      ?? env.OPENAI_MODEL,
  );
  const resolvedEnv: Record<string, string> = {};
  const missingConfigKeys: string[] = [];
  const invalidConfigKeys: string[] = [];

  if (providerConfig.provider) {
    resolvedEnv.AGENT_SERVICE_MODEL_PROVIDER = providerConfig.provider;
  } else if (providerConfig.invalidConfigKey) {
    invalidConfigKeys.push(providerConfig.invalidConfigKey);
  } else {
    missingConfigKeys.push('AGENT_SERVICE_MODEL_PROVIDER');
  }

  if (modelName) {
    resolvedEnv.AGENT_SERVICE_MODEL_NAME = modelName;
  } else {
    missingConfigKeys.push('AGENT_SERVICE_MODEL_NAME');
  }

  return {
    ...(providerConfig.provider ? { provider: providerConfig.provider } : {}),
    modelNameConfigured: Boolean(modelName),
    env: resolvedEnv,
    missingConfigKeys,
    ...(invalidConfigKeys.length > 0 ? { invalidConfigKeys } : {}),
  };
}

function resolveProvider(env: Record<string, string | undefined>): {
  provider?: MafShadowLiveSmokeProvider;
  invalidConfigKey?: string;
} {
  const configuredProvider = normalized(env.AGENT_SERVICE_MODEL_PROVIDER);
  if (configuredProvider !== undefined) {
    const provider = normalizeProvider(configuredProvider);
    return provider
      ? { provider }
      : { invalidConfigKey: 'AGENT_SERVICE_MODEL_PROVIDER' };
  }

  const inferredProvider = inferProvider(env);
  return inferredProvider ? { provider: inferredProvider } : {};
}

function inferProvider(env: Record<string, string | undefined>): MafShadowLiveSmokeProvider | undefined {
  if (
    normalized(env.AZURE_OPENAI_ENDPOINT)
    && normalized(env.AZURE_OPENAI_API_KEY)
    && normalized(env.AZURE_OPENAI_API_VERSION)
  ) {
    return 'azure_openai';
  }

  if (normalized(env.AGENT_SERVICE_AZURE_OPENAI_ENDPOINT)
    && normalized(env.AGENT_SERVICE_AZURE_OPENAI_API_KEY)
    && normalized(env.AGENT_SERVICE_AZURE_OPENAI_API_VERSION)) {
    return 'azure_openai';
  }

  if (normalized(env.OPENAI_API_KEY) || normalized(env.AGENT_SERVICE_OPENAI_API_KEY)) {
    return 'openai';
  }

  return undefined;
}

function normalizeProvider(provider: string): MafShadowLiveSmokeProvider | undefined {
  return provider === 'openai' || provider === 'azure_openai' ? provider : undefined;
}

function normalized(value: string | undefined): string | undefined {
  const text = typeof value === 'string' ? value.trim() : '';
  return text || undefined;
}

function runtimeResolving(result: ProcessMessageResult): TypeScriptAgentRuntime {
  return {
    processMessage: async () => result,
  } as unknown as TypeScriptAgentRuntime;
}
