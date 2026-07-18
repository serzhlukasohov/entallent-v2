import type { ConversationRecord, WorkspaceConnectionRecord } from '../types/records';

export interface FollowUpContextData {
  user: {
    proactiveMessagingEnabled: boolean;
    timezone: string;
    quietHours: { enabled: boolean; startHour?: number; endHour?: number };
    preferredName?: string;
  };
  conversation: ConversationRecord | null;
  workspaceConnection: WorkspaceConnectionRecord | null;
  lastInboundAt: Date | null;
  recentProactiveCount24h: number;
  recentProactiveCount7d: number;
  hasActiveHighRisk: boolean;
}

export interface FollowUpContextPort {
  load(params: {
    userId: string;
    tenantId: string;
    conversationId?: string;
    channelType?: string;
  }): Promise<FollowUpContextData>;
}
