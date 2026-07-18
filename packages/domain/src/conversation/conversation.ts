export type ChannelType = 'slack' | 'teams' | 'telegram' | 'whatsapp';

export type ConversationStatus = 'active' | 'archived';

export interface ActiveTopic {
  type: string;
  summary: string;
  startedAt: Date;
}

export interface Conversation {
  readonly id: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly channelType: ChannelType;
  readonly externalConversationId: string;
  readonly status: ConversationStatus;
  readonly lastMessageAt: Date | null;
  readonly activeTopic: ActiveTopic | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}
