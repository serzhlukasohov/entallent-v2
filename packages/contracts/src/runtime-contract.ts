export type RuntimeJsonPrimitive = string | number | boolean | null;
export type RuntimeJsonValue =
  | RuntimeJsonPrimitive
  | RuntimeJsonValue[]
  | { [key: string]: RuntimeJsonValue };

export type RuntimeProcessMessageRequest = {
  requestId: string;
  eventId: string;
  traceId: string;
  idempotencyKey: string;
  runtimeAttempt: number;
  tenant: RuntimeTenant;
  user: RuntimeUser;
  conversation: RuntimeConversation;
  message: RuntimeMessage;
  context: RuntimeContext;
};

export type RuntimeTenant = {
  id: string;
  workspaceId: string;
};

export type RuntimeUser = {
  id: string;
  displayName?: string;
  timezone?: string;
  locale?: string;
};

export type RuntimeConversation = {
  id: string;
  channel: 'slack';
  externalWorkspaceId: string;
  externalConversationId: string;
  threadId?: string;
  sessionKey: string;
};

export type RuntimeMessage = {
  id: string;
  text: string;
  createdAt: string;
};

export type RuntimeContext = {
  recentTurns: RuntimeRecentTurn[];
  memoryItems: RuntimeMemoryItem[];
  goals: RuntimeGoal[];
};

export type RuntimeRecentTurn = {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
};

export type RuntimeMemoryItem = {
  id: string;
  category: string;
  content: string;
  importance: number;
};

export type RuntimeGoal = {
  id: string;
  title: string;
  status: string;
};

export type RuntimeResult = {
  reply: RuntimeReply;
  riskAssessment?: RuntimeRiskAssessment;
  memoryCandidates: RuntimeMemoryCandidate[];
  proposedActions: RuntimeActionProposal[];
  diagnostics: RuntimeDiagnostics;
};

export type RuntimeReply = {
  text: string;
  mode?: string;
};

export type RuntimeRiskAssessment = {
  type: string | null;
  severity: 'none' | 'low' | 'medium' | 'high' | 'critical';
  confidence: number;
  evidence: string[];
  immediateResponseRequired: boolean;
  escalationRecommended: boolean;
  surveyMustBeBlocked: boolean;
  proactiveMessagesMustBePaused: boolean;
};

export type RuntimeMemoryCandidate = {
  actionId: string;
  type: string;
  content: string;
  confidence: number;
  sensitivity?: 'normal' | 'sensitive' | 'highly_sensitive';
  sourceMessageIds: string[];
};

export type RuntimeActionProposal =
  | RuntimeSaveMemoryActionProposal
  | RuntimeScheduleFollowUpActionProposal
  | RuntimeUpdateGoalActionProposal;

export type RuntimeSaveMemoryActionProposal = {
  actionId: string;
  type: 'save_memory';
  idempotencyKey: string;
  memoryCandidateId: string;
};

export type RuntimeScheduleFollowUpActionProposal = {
  actionId: string;
  type: 'schedule_follow_up';
  idempotencyKey: string;
  executeAt: string;
  intent: string;
  deduplicationKey: string;
};

export type RuntimeUpdateGoalActionProposal = {
  actionId: string;
  type: 'update_goal';
  idempotencyKey: string;
  goalId?: string;
  changes: { [key: string]: RuntimeJsonValue };
};

export type RuntimeDiagnostics = {
  traceId: string;
  runtimeVersion: string;
  modelCalls: number;
  toolCalls: number;
  latencyMs: number;
};

export type RuntimeErrorCategory =
  | 'unavailable'
  | 'validation_error'
  | 'timeout'
  | 'duplicate_request'
  | 'dependency_failed'
  | 'unsafe_partial_result';

export type RuntimeErrorResponse = {
  traceId: string;
  errorCategory: RuntimeErrorCategory;
  retryable: boolean;
  fallbackAllowed: boolean;
  message: string;
};
