export interface WorkspaceIdentity {
  tenantId: string;
  signingSecret: string;
}

export interface IngestMessageParams {
  tenantId: string;
  userId: string;
  conversationId: string;
  text: string;
  externalMessageId?: string;
  externalThreadId?: string;
  occurredAt: Date;
  traceId: string;
}

export interface IngestMessageResult {
  messageId: string;
}

export interface IngestionRepositoryPort {
  findWorkspaceIdentity(
    channelType: string,
    externalWorkspaceId: string,
  ): Promise<WorkspaceIdentity | null>;

  findOrCreateUser(params: {
    tenantId: string;
    channelType: string;
    externalWorkspaceId: string;
    externalUserId: string;
    displayName?: string;
  }): Promise<{ userId: string }>;

  findOrCreateConversation(params: {
    tenantId: string;
    userId: string;
    channelType: string;
    externalConversationId: string;
  }): Promise<{ conversationId: string }>;

  saveInboundMessage(params: IngestMessageParams): Promise<IngestMessageResult>;
}
