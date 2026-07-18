import type {
  NormalizedChannelEvent,
  OutgoingMessage,
  SendMessageResult,
  ExternalUserProfile,
} from '@entalent/contracts';

export interface UpdateOutgoingMessage {
  tenantId: string;
  conversationId: string;
  externalMessageId: string;
  text: string;
  metadata?: Record<string, unknown>;
}

/**
 * Port that every channel integration must implement.
 * The domain and application layers depend only on this interface —
 * they never import Slack SDK, Teams SDK, or any channel-specific code.
 */
export interface ChannelAdapterPort {
  readonly channelType: string;

  verifyRequest(input: unknown): Promise<boolean>;

  normalizeEvent(input: unknown): Promise<NormalizedChannelEvent[]>;

  sendMessage(message: OutgoingMessage): Promise<SendMessageResult>;

  updateMessage?(message: UpdateOutgoingMessage): Promise<void>;

  getUserProfile?(
    externalWorkspaceId: string,
    externalUserId: string,
  ): Promise<ExternalUserProfile>;
}
