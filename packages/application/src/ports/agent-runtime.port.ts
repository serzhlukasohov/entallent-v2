import type {
  ConversationMode,
  RiskDetection,
  SituationClassification,
} from '@entalent/contracts';

export const AGENT_RUNTIME_PORT = Symbol('AGENT_RUNTIME_PORT');

export interface ProcessMessageRequest {
  messageId: string;
  conversationId: string;
  userId: string;
  tenantId: string;
  externalWorkspaceId: string;
  externalConversationId: string;
  traceId: string;
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
