import type { DialogueAct, SituationClassification } from './ai';

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
  requestPurpose?: RuntimeRequestPurpose;
  tenant: RuntimeTenant;
  user: RuntimeUser;
  conversation: RuntimeConversation;
  message: RuntimeMessage;
  context: RuntimeContext;
  proactiveContext?: RuntimeProactiveContext;
};

export type RuntimeRequestPurpose = 'inbound_message' | 'proactive_check_in';

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
  styleAdaptation?: RuntimeStyleAdaptation;
  replyPlan?: RuntimeReplyPlan;
  replyPlanning?: RuntimeReplyPlanningDiagnostics;
  replyPolicy?: RuntimeReplyPolicy;
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

export type RuntimeStyleAdaptation = {
  dimensions: {
    register: number;
    humor: number;
    verbosity: number;
    emoji: number;
  };
  weight: number;
  phrases: string[];
};

export type RuntimeReplyPlan = {
  dialogueAct: DialogueAct;
  latestUserSubstance: string | null;
  topicAnchor: string | null;
  memoryAnchors: RuntimeReplyMemoryAnchor[];
  responseMove:
    | 'social_greeting'
    | 'social_reply'
    | 'address_new_substance'
    | 'continue_existing_thread'
    | 'answer_request'
    | 'support_emotion'
    | 'close_or_pause';
  mayInferFromBrevity: boolean;
  questionPolicy: RuntimeReplyQuestionPolicy;
  requiredGrounding: RuntimeReplyRequiredGrounding[];
  forbiddenMoves: RuntimeReplyForbiddenMove[];
};

export type RuntimeReplyMemoryAnchor = {
  category: string;
  content: string;
};

export type RuntimeReplyQuestionPolicy = {
  maxQuestions: 0 | 1;
  reason:
    | 'strategy_disallows_questions'
    | 'greeting_no_question'
    | 'social_checkin_returns_question'
    | 'acknowledgement_no_new_substance'
    | 'asked_recently'
    | 'new_substance_allows_question';
};

export type RuntimeReplyRequiredGrounding = {
  source: 'memory';
  category: string;
  content: string;
  requirement: 'mention_explicitly';
};

export type RuntimeReplyForbiddenMove =
  | 'comment_on_brevity'
  | 'diagnose'
  | 'survey_probe'
  | 'operational_status'
  | 'action_plan';

export type RuntimeReplyPlanningDiagnostics = {
  status: 'available' | 'unavailable';
  reason?: 'classifier_failed';
};

export type RuntimeReplyPolicy = {
  maxChars: number;
  maxQuestions: 0 | 1;
  allowReflectiveOpener: boolean;
  allowListFormatting: boolean;
};

export type RuntimeProactiveContext = {
  reason: 'pulse_check_in';
  probeQuestion?: RuntimePulseProbeQuestion;
};

export type RuntimePulseProbeQuestion = {
  id: string;
  stableKey?: string;
  title?: string;
  group?: string;
  probeStrategies: string[];
};

export type RuntimeResult = {
  reply: RuntimeReply;
  riskAssessment?: RuntimeRiskAssessment;
  memoryCandidates: RuntimeMemoryCandidate[];
  proposedActions: RuntimeActionProposal[];
  classification: SituationClassification;
  diagnostics: RuntimeDiagnostics;
};

export type RuntimeReply = {
  text: string;
  mode?: string;
  metadata?: RuntimeReplyMetadata;
};

export type RuntimeReplyMetadata = {
  containsSurveyProbe?: boolean;
  surveyProbeQuestionId?: string;
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
  | RuntimeSaveMemoryActionEnvelope
  | RuntimeScheduleFollowUpActionEnvelope
  | RuntimeUpdateGoalActionEnvelope;

type RuntimeActionEnvelopeBase<
  AggregateType extends RuntimeActionAggregateType,
  ActionType extends RuntimeActionType,
  Payload extends RuntimeJsonValue,
> = RuntimeActionLifecycleState & {
  actionId: string;
  aggregateType: AggregateType;
  actionType: ActionType;
  idempotencyKey: string;
  payload: Payload;
};

export type RuntimeActionAggregateType = 'memory' | 'follow_up' | 'goal';

export type RuntimeActionType =
  | 'save_memory'
  | 'schedule_follow_up'
  | 'update_goal';

export type RuntimeSaveMemoryActionEnvelope = RuntimeActionEnvelopeBase<
  'memory',
  'save_memory',
  RuntimeSaveMemoryActionPayload
>;

export type RuntimeScheduleFollowUpActionEnvelope = RuntimeActionEnvelopeBase<
  'follow_up',
  'schedule_follow_up',
  RuntimeScheduleFollowUpActionPayload
>;

export type RuntimeUpdateGoalActionEnvelope = RuntimeActionEnvelopeBase<
  'goal',
  'update_goal',
  RuntimeUpdateGoalActionPayload
>;

export type RuntimeSaveMemoryActionPayload = {
  memoryCandidateId: string;
};

export type RuntimeScheduleFollowUpActionPayload = {
  executeAt: string;
  intent: string;
  deduplicationKey: string;
};

export type RuntimeUpdateGoalActionPayload = {
  goalId?: string;
  changes: { [key: string]: RuntimeJsonValue };
};

export type RuntimeActionLifecycleState =
  | RuntimeUncommittedActionLifecycleState
  | RuntimeCommittedActionLifecycleState;

export type RuntimeUncommittedActionLifecycleState = {
  validationResult: RuntimeActionValidationResult;
  executionStatus: Exclude<RuntimeActionExecutionStatus, 'committed'>;
  commitMarker: null;
};

export type RuntimeCommittedActionLifecycleState = {
  validationResult: RuntimeValidActionValidationResult;
  executionStatus: 'committed';
  commitMarker: RuntimeCommittedActionCommitMarker;
};

export type RuntimeActionValidationResult =
  | RuntimePendingActionValidationResult
  | RuntimeValidActionValidationResult
  | RuntimeInvalidActionValidationResult;

export type RuntimePendingActionValidationResult = {
  status: 'pending';
  reasonCodes: string[];
  message?: string;
};

export type RuntimeValidActionValidationResult = {
  status: 'valid';
  reasonCodes: string[];
  message?: string;
};

export type RuntimeInvalidActionValidationResult = {
  status: 'invalid';
  reasonCodes: string[];
  message?: string;
};

export type RuntimeActionExecutionStatus =
  | 'not_started'
  | 'blocked'
  | 'committed'
  | 'failed';

export type RuntimeActionCommitMarker = RuntimeCommittedActionCommitMarker | null;

export type RuntimeCommittedActionCommitMarker = {
  committedAt: string;
  referenceId: string;
};

export type RuntimeDiagnostics = {
  traceId: string;
  runtimeVersion: string;
  runtimeAttempt: number;
  modelCalls: number;
  toolCalls: number;
  latencyMs: number;
  retryCount: number;
  modelRetryCount: number;
  toolRetryCount: number;
  httpRetryCount: number;
  replyRenderer?:
    | 'workflow_static'
    | 'llm'
    | 'deterministic_social_reply'
    | 'deterministic_acknowledgement_reply'
    | 'deterministic_support_emotion_reply';
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
