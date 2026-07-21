export interface ConversationRecord {
  id: string;
  tenantId: string;
  userId: string;
  channelType: string;
  externalConversationId: string;
  status: string;
  userDisplayName?: string;
  /** IANA timezone of the conversation's user, if known */
  userTimezone?: string;
}

export interface MessageRecord {
  id: string;
  conversationId: string;
  tenantId: string;
  userId: string;
  direction: 'inbound' | 'outbound';
  text: string;
  externalMessageId?: string;
  externalThreadId?: string;
  occurredAt: Date;
  createdAt: Date;
  metadata?: Record<string, unknown>;
}

export interface WorkspaceConnectionRecord {
  id: string;
  tenantId: string;
  channelType: string;
  externalWorkspaceId: string;
  botToken: string;
  signingSecret: string;
}

export interface ChannelAccountRecord {
  id: string;
  userId: string;
  tenantId: string;
  channelType: string;
  externalWorkspaceId: string;
  externalUserId: string;
  displayName?: string;
}

export interface MemoryItemRecord {
  id: string;
  tenantId: string;
  userId: string;
  category: string;
  canonicalKey?: string;
  content: string;
  structuredValue?: Record<string, unknown>;
  confidence: number;
  importance: number;
  sensitivity: string;
  status: string;
  sourceMessageIds: string[];
  sourceType: string;
  validFrom: Date;
  expiresAt?: Date;
  supersededById?: string;
  extractorVersion?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserRecord {
  id: string;
  tenantId: string;
  status: string;
  preferredName?: string;
  timezone: string;
  proactiveMessagingEnabled: boolean;
  quietHours: { enabled: boolean; startHour?: number; endHour?: number };
}

export interface ScheduledActionRecord {
  id: string;
  tenantId: string;
  userId: string;
  conversationId?: string;
  type: string;
  intent: string;
  context: Record<string, unknown>;
  reason?: string;
  dueAt: Date;
  timezone: string;
  status: string;
  cancellationConditions: string[];
  attemptCount: number;
  maxAttempts: number;
  lastAttemptAt?: Date;
  deduplicationKey?: string;
  sourceMessageIds: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface RiskSignalRecord {
  id: string;
  tenantId: string;
  userId: string;
  type: string;
  severity: string;
  confidence: number;
  evidenceMessageIds: string[];
  status: string;
  recommendedAction?: string;
  policyVersion?: string;
  detectedAt: Date;
  resolvedAt?: Date;
  expiresAt?: Date;
}

export interface SurveyQuestionRecord {
  id: string;
  surveyDefinitionId: string;
  stableKey: string;
  title: string;
  canonicalMeaning: string;
  dimension: string;
  positiveIndicators: string[];
  negativeIndicators: string[];
  probeStrategies: string[];
  contraindications: string[];
  confidenceThreshold: number;
  completenessThreshold: number;
  minimumEvidenceCount: number;
  cooldownDays: number;
  maxFollowUpProbes: number;
  displayOrder: number;
  version: string;
  questionGroup: string;  // 'autonomy' | 'growth' | 'purpose' | 'belonging' | 'engagement'
  responseType: string;   // 'open_ended' | 'numeric_0_10'
}

export interface SurveyWindowRecord {
  id: string;
  tenantId: string;
  userId: string;
  surveyDefinitionId: string;
  periodType: string;
  periodStart: Date;
  periodEnd: Date;
  status: string;
}

export interface SurveyEvidenceRecord {
  id: string;
  surveyWindowId: string;
  surveyQuestionId: string;
  userId: string;
  sourceMessageIds: string[];
  evidenceSummary: string;
  polarity: string;
  strength: number;
  completeness: number;
  confidence: number;
  evaluatorVersion: string;
  promptVersion: string;
  createdAt: Date;
}

export interface UserGoalRecord {
  id: string;
  tenantId: string;
  userId: string;
  title: string;
  description?: string;
  category: string;
  status: string;
  priority: string;
  targetDate?: Date;
  sourceMessageIds: string[];
  confidence: number;
  completedAt?: Date;
  cancelledAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface SurveyGroupStateRecord {
  id: string;
  surveyWindowId: string;
  userId: string;
  tenantId: string;
  questionGroup: string;
  status: string;  // 'in_progress' | 'pending_confirmation' | 'confirmed' | 'report_sent'
  aiSummary: string | null;
  employeeScore: number | null;
  personalRecs: unknown | null;
  confirmedAt: Date | null;
  reportSentAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface TeamRecord {
  id: string;
  tenantId: string;
  name: string;
  managerSlackUserId: string | null;
  createdAt: Date;
}

export interface TeamMembershipRecord {
  id: string;
  teamId: string;
  userId: string;
  role: string;
  joinedAt: Date;
  leftAt: Date | null;
}
