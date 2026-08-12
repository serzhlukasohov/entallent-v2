import type {
  ConversationMode,
  RiskDetection,
  RuntimeContext,
  SituationClassification,
} from '@entalent/contracts';

export const AGENT_RUNTIME_PORT = Symbol('AGENT_RUNTIME_PORT');

export interface ProcessMessageRequest {
  requestId?: string;
  eventId?: string;
  runtimeAttempt?: number;
  requestPurpose?: 'inbound_message' | 'proactive_check_in';
  messageId: string;
  conversationId: string;
  userId: string;
  tenantId: string;
  externalWorkspaceId: string;
  externalConversationId: string;
  traceId: string;
  messageText?: string;
  messageCreatedAt?: string;
  userDisplayName?: string;
  userTimezone?: string;
  userLocale?: string;
  conversationSessionKey?: string;
  conversationThreadId?: string;
  runtimeContext?: RuntimeContext;
  proactiveContext?: ProactiveRuntimeContext;
}

export type RuntimeBoundaryProcessMessageRequest = ProcessMessageRequest & {
  requestId: string;
  eventId: string;
  runtimeAttempt: number;
};

export interface ProcessMessageResult {
  outboundMessageId: string;
  responseText: string;
  mode: ConversationMode;
  classification: SituationClassification;
  risk: RiskDetection;
  replyMetadata?: ProcessMessageReplyMetadata;
}

export interface ProactiveRuntimeContext {
  reason: 'pulse_check_in';
  probeQuestion?: {
    id: string;
    stableKey?: string;
    title?: string;
    group?: string;
    probeStrategies: string[];
  };
}

export interface ProcessMessageReplyMetadata {
  containsSurveyProbe?: boolean;
  surveyProbeQuestionId?: string;
}

/** @deprecated Use ProcessMessageRequest. */
export type ProcessMessageInput = ProcessMessageRequest;

export interface AgentRuntimePort {
  processMessage(request: ProcessMessageRequest): Promise<ProcessMessageResult>;
}

export function isRuntimeBoundaryProcessMessageRequest(
  request: ProcessMessageRequest,
): request is RuntimeBoundaryProcessMessageRequest {
  return runtimeBoundaryProcessMessageRequestInvalidFields(request).length === 0;
}

export function runtimeBoundaryProcessMessageRequestInvalidFields(
  request: ProcessMessageRequest,
): string[] {
  const invalidFields: string[] = [];
  if (!normalizeOptionalString(request.requestId)) {
    invalidFields.push('requestId');
  }
  if (!normalizeOptionalString(request.eventId)) {
    invalidFields.push('eventId');
  }
  if (!Number.isInteger(request.runtimeAttempt) || request.runtimeAttempt === undefined || request.runtimeAttempt < 1) {
    invalidFields.push('runtimeAttempt');
  }
  return invalidFields;
}

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.trim();
  return normalized ? normalized : undefined;
}
