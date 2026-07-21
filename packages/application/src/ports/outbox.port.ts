export interface MessageSendPayload {
  messageId: string;
  tenantId: string;
  conversationId: string;
  channelType: string;
  externalWorkspaceId: string;
  externalChannelId: string;
  text: string;
  replyToExternalThreadId?: string;
}

export interface MemoryExtractionPayload {
  conversationId: string;
  userId: string;
  tenantId: string;
  inboundMessageId: string;
  outboundMessageId: string;
  traceId: string;
  channelType: string;
  externalConversationId: string;
}

export interface FollowUpExecutionPayload {
  scheduledActionId: string;
  tenantId: string;
  userId: string;
  traceId: string;
  dueAt: Date;
}

export interface SurveyEvidencePayload {
  conversationId: string;
  userId: string;
  tenantId: string;
  inboundMessageId: string;
  traceId: string;
}

export interface GroupConfirmationPayload {
  surveyWindowId: string;
  userId: string;
  tenantId: string;
  questionGroup: string;
  traceId: string;
}

export interface GroupReportPayload {
  teamId: string;
  questionGroup: string;
  traceId: string;
}

export interface OutboxPort {
  enqueueMessageSend(payload: MessageSendPayload): Promise<void>;
  enqueueMemoryExtraction(payload: MemoryExtractionPayload): Promise<void>;
  enqueueFollowUpExecution(payload: FollowUpExecutionPayload): Promise<void>;
  enqueueSurveyEvidence(payload: SurveyEvidencePayload): Promise<void>;
  enqueueGroupConfirmation(payload: GroupConfirmationPayload): Promise<void>;
  enqueueGroupReport(payload: GroupReportPayload): Promise<void>;
}
