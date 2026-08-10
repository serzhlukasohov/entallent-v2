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
}

export interface ProcessMessageResult {
  outboundMessageId: string;
  responseText: string;
  mode: ConversationMode;
  classification: SituationClassification;
  risk: RiskDetection;
}

/** @deprecated Use ProcessMessageRequest. */
export type ProcessMessageInput = ProcessMessageRequest;

export interface AgentRuntimePort {
  processMessage(request: ProcessMessageRequest): Promise<ProcessMessageResult>;
}
