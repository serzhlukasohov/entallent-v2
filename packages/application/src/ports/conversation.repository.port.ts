import type {
  ConversationActiveTopicRecord,
  ConversationRecord,
  MessageRecord,
  ReportingDisclosureReceiptRecord,
} from '../types/records';

export interface SaveMessageParams {
  id?: string;
  conversationId: string;
  tenantId: string;
  userId: string;
  direction: 'inbound' | 'outbound';
  text: string;
  externalMessageId?: string;
  externalThreadId?: string;
  occurredAt?: Date;
  traceId?: string;
  messageType?: string;
  metadata?: Record<string, unknown>;
}

export type ConversationDispatchKind =
  | 'message_send' | 'memory_extraction' | 'style_analysis' | 'survey_evidence'
  | 'profile_hydration';

export interface ConversationRepositoryPort {
  findMessageById?(id: string, tenantId: string, conversationId: string): Promise<MessageRecord | null>;
  findById(id: string, tenantId: string): Promise<ConversationRecord | null>;
  findRecentMessages(conversationId: string, limit: number): Promise<MessageRecord[]>;
  /** Historical context ending at the scoped inbound source, even after newer messages arrive. */
  findMessagesThrough?(input: {
    conversationId: string;
    tenantId: string;
    userId: string;
    inboundMessageId: string;
    limit: number;
  }): Promise<MessageRecord[]>;
  findLatestDeliveredReportingDisclosure(
    tenantId: string,
    userId: string,
    version: string,
    before: Date,
  ): Promise<ReportingDisclosureReceiptRecord | null>;
  updateActiveTopic(
    conversationId: string,
    tenantId: string,
    userId: string,
    activeTopic: ConversationActiveTopicRecord,
  ): Promise<void>;
  saveMessage(params: SaveMessageParams): Promise<MessageRecord>;
  /** Called inside the turn transaction; locks its admission before checking a committed replay. */
  findCommittedTurnForInbound?(input: {
    inboundMessageId: string; tenantId: string; userId: string; conversationId: string;
    externalWorkspaceId?: string; externalConversationId?: string;
  }): Promise<MessageRecord | null>;
  recordCommittedTurn?(input: {
    inboundMessageId: string; outboundMessageId: string;
    tenantId: string; userId: string; conversationId: string;
    dispatchKinds: ConversationDispatchKind[];
    followUpActions?: Array<{ id: string; dueAt: Date }>;
    groupReportStateIds?: string[];
  }): Promise<void>;
  findUnqueuedCommittedDispatchKinds?(input: {
    inboundMessageId: string; tenantId: string; userId: string; conversationId: string;
  }): Promise<ConversationDispatchKind[] | null>;
  findUnqueuedCommittedFollowUps?(input: {
    inboundMessageId: string; tenantId: string; userId: string; conversationId: string;
  }): Promise<Array<{ scheduledActionId: string; dueAt: Date }> | null>;
  findUnqueuedCommittedGroupReports?(input: {
    inboundMessageId: string; tenantId: string; userId: string; conversationId: string;
  }): Promise<Array<{
    groupStateId: string; reportingCohortId: string; teamId: string; questionGroup: string;
  }> | null>;
  markCommittedDispatchQueued?(input: {
    inboundMessageId: string; tenantId: string; userId: string; conversationId: string;
    kind: ConversationDispatchKind | 'follow_up_execution' | 'group_report';
    targetId?: string;
  }): Promise<void>;
  updateMessageDelivery(
    messageId: string,
    params: {
      tenantId: string;
      conversationId: string;
      externalMessageId: string;
      externalThreadId?: string;
      sentAt: Date;
    },
  ): Promise<Date>;
}
