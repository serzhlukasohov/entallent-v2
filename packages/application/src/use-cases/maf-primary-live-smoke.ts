import type { ConversationRepositoryPort } from '../ports/conversation.repository.port';
import type { OutboxPort } from '../ports/outbox.port';
import type { MessageRecord } from '../types/records';
import type { ProcessMessageRequest } from '../ports/agent-runtime.port';
import type { MafAgentRuntimeFetch } from './maf-agent-runtime-client';
import { MafAgentRuntimeClient } from './maf-agent-runtime-client';
import { MafPrimaryAgentRuntime } from './maf-primary-agent-runtime';

export type MafPrimaryLiveSmokeStatus = 'valid' | 'invalid';
export type MafPrimaryLiveSmokeValidationStatus = 'contract_valid' | 'contract_invalid' | 'not_run';

export interface MafPrimaryLiveSmokeOptions {
  serviceUrl: string;
  timeoutMs?: number;
  fetch?: MafAgentRuntimeFetch;
  request?: ProcessMessageRequest;
}

export interface MafPrimaryLiveSmokeEvidence {
  status: MafPrimaryLiveSmokeStatus;
  validationStatus: MafPrimaryLiveSmokeValidationStatus;
  traceId: string;
  failureReason?: string;
  primary?: {
    mode: 'maf_primary';
    runtimeVersion: string;
    modelCalls: number;
    toolCalls: number;
    retryCount: number;
    riskSeverity: string;
    outboundMessageSaved: boolean;
    messageSendQueued: boolean;
    memoryExtractionQueued: boolean;
    surveyEvidenceQueued: boolean;
  };
}

const DEFAULT_LIVE_PRIMARY_REQUEST: ProcessMessageRequest = {
  requestId: '11111111-1111-4111-8111-111111111111',
  eventId: '22222222-2222-4222-8222-222222222222',
  runtimeAttempt: 1,
  messageId: '33333333-3333-4333-8333-333333333333',
  conversationId: '44444444-4444-4444-8444-444444444444',
  userId: '33333333-3333-4333-8333-333333333333',
  tenantId: 'tenant-demo',
  externalWorkspaceId: 'workspace-demo',
  externalConversationId: 'conversation-demo',
  traceId: 'trace-runtime-primary-smoke',
  messageText: 'Synthetic message for runtime primary validation.',
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
    memoryItems: [],
    goals: [],
  },
};

export async function runMafPrimaryLiveSmoke(
  options: MafPrimaryLiveSmokeOptions,
): Promise<MafPrimaryLiveSmokeEvidence> {
  const request = options.request ?? DEFAULT_LIVE_PRIMARY_REQUEST;
  const recorder = new InMemoryPrimaryRecorder();
  const client = new MafAgentRuntimeClient({
    serviceUrl: options.serviceUrl,
    ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
  const runtime = new MafPrimaryAgentRuntime(
    recorder.conversationRepo,
    recorder.outbox,
    client,
    { isEnabled: async () => true },
  );

  let result: Awaited<ReturnType<MafPrimaryAgentRuntime['processMessage']>>;
  try {
    result = await runtime.processMessage(request);
  } catch (error) {
    return {
      status: 'invalid',
      validationStatus: 'contract_invalid',
      traceId: safeTraceId(request.traceId),
      failureReason: safeFailureReason(error),
    };
  }

  const metadata = recorder.savedOutbound?.metadata;
  if (!isPrimaryMetadata(metadata) || metadata.modelCalls !== 1) {
    return {
      status: 'invalid',
      validationStatus: isPrimaryMetadata(metadata) ? 'contract_valid' : 'not_run',
      traceId: safeTraceId(request.traceId),
      failureReason: isPrimaryMetadata(metadata) ? 'model_call_count_invalid' : 'primary_persistence_missing',
    };
  }

  return {
    status: 'valid',
    validationStatus: 'contract_valid',
    traceId: safeTraceId(request.traceId),
    primary: {
      mode: 'maf_primary',
      runtimeVersion: metadata.runtimeVersion,
      modelCalls: metadata.modelCalls,
      toolCalls: metadata.toolCalls,
      retryCount: metadata.retryCount,
      riskSeverity: result.risk.severity,
      outboundMessageSaved: Boolean(recorder.savedOutbound),
      messageSendQueued: recorder.messageSendQueued,
      memoryExtractionQueued: recorder.memoryExtractionQueued,
      surveyEvidenceQueued: recorder.surveyEvidenceQueued,
    },
  };
}

class InMemoryPrimaryRecorder {
  savedOutbound?: MessageRecord;
  messageSendQueued = false;
  memoryExtractionQueued = false;
  surveyEvidenceQueued = false;

  readonly conversationRepo: ConversationRepositoryPort = {
    findById: async (id, tenantId) => ({
      id,
      tenantId,
      userId: DEFAULT_LIVE_PRIMARY_REQUEST.userId,
      channelType: 'dev',
      externalConversationId: DEFAULT_LIVE_PRIMARY_REQUEST.externalConversationId,
      status: 'active',
    }),
    findRecentMessages: async () => [],
    saveMessage: async (params) => {
      const now = new Date();
      const record: MessageRecord = {
        id: 'maf-primary-smoke-outbound',
        conversationId: params.conversationId,
        tenantId: params.tenantId,
        userId: params.userId,
        direction: params.direction,
        text: params.text,
        externalMessageId: params.externalMessageId,
        externalThreadId: params.externalThreadId,
        occurredAt: params.occurredAt ?? now,
        createdAt: now,
        metadata: params.metadata,
      };
      this.savedOutbound = record;
      return record;
    },
    updateMessageDelivery: async () => undefined,
  };

  readonly outbox: OutboxPort = {
    enqueueMessageSend: async () => {
      this.messageSendQueued = true;
    },
    enqueueMemoryExtraction: async () => {
      this.memoryExtractionQueued = true;
    },
    enqueueFollowUpExecution: async () => undefined,
    enqueueSurveyEvidence: async () => {
      this.surveyEvidenceQueued = true;
    },
    enqueueGroupReport: async () => undefined,
    enqueueStyleAnalysis: async () => undefined,
    enqueueProfileHydration: async () => undefined,
  };
}

function isPrimaryMetadata(value: unknown): value is {
  runtimeVersion: string;
  modelCalls: number;
  toolCalls: number;
  retryCount: number;
} {
  return (
    typeof value === 'object'
    && value !== null
    && 'runtimeVersion' in value
    && typeof (value as { runtimeVersion?: unknown }).runtimeVersion === 'string'
    && 'modelCalls' in value
    && typeof (value as { modelCalls?: unknown }).modelCalls === 'number'
    && 'toolCalls' in value
    && typeof (value as { toolCalls?: unknown }).toolCalls === 'number'
    && 'retryCount' in value
    && typeof (value as { retryCount?: unknown }).retryCount === 'number'
  );
}

const SAFE_TRACE_ID_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/;
const SECRET_LIKE_PATTERN = /(api[_-]?key|bearer|password|secret|token|xox[abprs]-|sk-[A-Za-z0-9_-]+)/i;

function safeTraceId(traceId: string): string {
  return SAFE_TRACE_ID_PATTERN.test(traceId) && !SECRET_LIKE_PATTERN.test(traceId)
    ? traceId
    : 'redacted';
}

function safeFailureReason(error: unknown): string {
  if (
    typeof error === 'object'
    && error !== null
    && 'safeDiagnostic' in error
    && isSafeDiagnostic((error as { safeDiagnostic?: unknown }).safeDiagnostic)
  ) {
    return (error as { safeDiagnostic: { reasonCode: string } }).safeDiagnostic.reasonCode;
  }

  return 'live_primary_smoke_failed';
}

function isSafeDiagnostic(value: unknown): value is { reasonCode: string } {
  return (
    typeof value === 'object'
    && value !== null
    && 'reasonCode' in value
    && typeof (value as { reasonCode?: unknown }).reasonCode === 'string'
    && SAFE_TRACE_ID_PATTERN.test((value as { reasonCode: string }).reasonCode)
    && !SECRET_LIKE_PATTERN.test((value as { reasonCode: string }).reasonCode)
  );
}
