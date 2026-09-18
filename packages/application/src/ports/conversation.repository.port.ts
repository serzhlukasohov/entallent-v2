import type {
  ConversationActiveTopicRecord,
  ConversationRecord,
  MessageRecord,
  ReportingDisclosureReceiptRecord,
} from '../types/records';

export interface SaveMessageParams {
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

export interface ConversationRepositoryPort {
  findById(id: string, tenantId: string): Promise<ConversationRecord | null>;
  findRecentMessages(conversationId: string, limit: number): Promise<MessageRecord[]>;
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
