export type ConversationJob = {
  messageId: string;
  conversationId: string;
  userId: string;
  tenantId: string;
  externalWorkspaceId: string;
  externalConversationId: string;
  traceId: string;
};

export type MessageSendJob = {
  messageId: string;
  tenantId: string;
  conversationId: string;
  channelType: string;
  externalWorkspaceId: string;
  externalChannelId: string;
  text: string;
  replyToExternalThreadId?: string;
};

export type CheckInJob = Omit<ConversationJob, 'messageId'>;
