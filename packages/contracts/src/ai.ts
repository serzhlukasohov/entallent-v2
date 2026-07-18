import { z } from 'zod';

// ── Situation Classifier ────────────────────────────────────────────────────

export const SituationIntentSchema = z.enum([
  'support',
  'coaching',
  'goal_setting',
  'progress_update',
  'casual_conversation',
  'clarification',
  'survey_opportunity',
  'conflict',
  'burnout_signal',
  'harassment_signal',
  'potential_crisis',
  'celebration',
  'onboarding',
  'feedback_request',
]);
export type SituationIntent = z.infer<typeof SituationIntentSchema>;

/**
 * An explicit request from the employee to be reminded about something.
 * Only set when the employee clearly asks for a reminder ("напомни мне…",
 * "remind me to…") — never inferred from a vague intention to do something.
 */
export const ReminderRequestSchema = z.object({
  /** What to remind them about, phrased in the employee's own language */
  intent: z.string(),
  /** Absolute ISO 8601 timestamp for when the reminder should fire */
  dueAt: z.string(),
});
export type ReminderRequest = z.infer<typeof ReminderRequestSchema>;

export const SituationClassificationSchema = z.object({
  primaryIntent: SituationIntentSchema,
  secondaryIntents: z.array(z.string()),
  emotionalState: z.array(z.string()),
  urgency: z.enum(['low', 'medium', 'high', 'critical']),
  confidence: z.number().min(0).max(1),
  requiresSafetyCheck: z.boolean(),
  surveyAllowed: z.boolean(),
  reasoningSummary: z.string(),
  /** Present only when the employee explicitly asked to be reminded of something */
  reminderRequest: ReminderRequestSchema.nullish(),
});
export type SituationClassification = z.infer<typeof SituationClassificationSchema>;

// ── Memory Extractor ────────────────────────────────────────────────────────

export const MemoryCategorySchema = z.enum([
  'profile_fact',
  'role',
  'team_context',
  'project_context',
  'goal',
  'concern',
  'stressor',
  'preference',
  'communication_preference',
  'commitment',
  'milestone',
  'relationship_context',
  'achievement',
  'recurring_topic',
  'support_preference',
]);
export type MemoryCategory = z.infer<typeof MemoryCategorySchema>;

export const MemoryItemProposalSchema = z.object({
  category: MemoryCategorySchema,
  canonicalKey: z.string().optional(),
  content: z.string(),
  structuredValue: z.record(z.unknown()).optional(),
  confidence: z.number().min(0).max(1),
  importance: z.number().min(0).max(1),
  sensitivity: z.enum(['normal', 'sensitive', 'highly_sensitive']),
  expectedLifetime: z.enum(['days', 'weeks', 'months', 'long_term']),
  sourceMessageIds: z.array(z.string()),
  action: z.enum(['create', 'update', 'supersede', 'ignore']),
  existingItemId: z.string().nullish(),
});
export type MemoryItemProposal = z.infer<typeof MemoryItemProposalSchema>;

export const GoalProposalSchema = z.object({
  title: z.string(),
  description: z.string().optional(),
  category: z.string(),
  targetDate: z.coerce.date().optional(),
  confidence: z.number().min(0).max(1),
  sourceMessageIds: z.array(z.string()),
  action: z.enum(['create', 'update', 'complete', 'cancel']),
  existingGoalId: z.string().nullish(),
});
export type GoalProposal = z.infer<typeof GoalProposalSchema>;

export const FollowUpCandidateSchema = z.object({
  type: z.string(),
  topic: z.string(),
  reason: z.string(),
  recommendedDelayDays: z.number(),
  earliestDaysFromNow: z.number(),
  latestDaysFromNow: z.number().optional(),
  relevanceChecks: z.array(z.string()),
  cancellationConditions: z.array(z.string()),
  messageStrategy: z.string(),
  confidence: z.number().min(0).max(1),
});
export type FollowUpCandidate = z.infer<typeof FollowUpCandidateSchema>;

export const MemoryProposalSchema = z.object({
  memoryItems: z.array(MemoryItemProposalSchema),
  goalProposals: z.array(GoalProposalSchema),
  commitmentProposals: z.array(z.record(z.unknown())),
  followUpCandidates: z.array(FollowUpCandidateSchema),
});
export type MemoryProposal = z.infer<typeof MemoryProposalSchema>;

// ── Risk Detector ───────────────────────────────────────────────────────────

export const RiskTypeSchema = z.enum([
  'burnout',
  'severe_stress',
  'workplace_harassment',
  'discrimination_report',
  'conflict_with_manager',
  'fear_of_termination',
  'potential_self_harm',
  'immediate_danger',
  'medical_request',
  'legal_request',
  'privacy_request',
]);
export type RiskType = z.infer<typeof RiskTypeSchema>;

export const RiskDetectionSchema = z.object({
  riskType: RiskTypeSchema.nullable(),
  severity: z.enum(['none', 'low', 'medium', 'high', 'critical']),
  confidence: z.number().min(0).max(1),
  evidence: z.array(z.string()),
  immediateResponseRequired: z.boolean(),
  escalationRecommended: z.boolean(),
  surveyMustBeBlocked: z.boolean(),
  proactiveMessagesMustBePaused: z.boolean(),
  reasoningSummary: z.string(),
});
export type RiskDetection = z.infer<typeof RiskDetectionSchema>;

// ── Survey Evidence Evaluator ───────────────────────────────────────────────

export const SurveyEvidenceEvaluationSchema = z.object({
  candidateQuestionIds: z.array(z.string()),
  evidence: z.array(
    z.object({
      questionId: z.string(),
      evidenceSummary: z.string(),
      polarity: z.enum(['positive', 'negative', 'neutral', 'mixed']),
      strength: z.number().min(0).max(1),
      completeness: z.number().min(0).max(1),
      confidence: z.number().min(0).max(1),
      followUpProbeNeeded: z.boolean(),
      thresholdReached: z.boolean(),
      assessmentShouldRemainUnknown: z.boolean(),
    }),
  ),
});
export type SurveyEvidenceEvaluation = z.infer<typeof SurveyEvidenceEvaluationSchema>;

// ── Response Generator ──────────────────────────────────────────────────────

export const ConversationModeSchema = z.enum([
  'normal',
  'supportive',
  'coaching',
  'sensitive',
  'crisis',
  'survey_probe',
  'proactive_follow_up',
  'onboarding',
  'celebration',
]);
export type ConversationMode = z.infer<typeof ConversationModeSchema>;

export const ReplyStrategySchema = z.object({
  mode: ConversationModeSchema,
  tone: z.enum(['warm', 'professional', 'empathetic', 'celebratory', 'neutral']),
  includeFollowUpQuestion: z.boolean(),
  surveyProbeQuestionId: z.string().optional(),
  maxResponseLength: z.enum(['short', 'medium', 'long']),
  forbiddenPatterns: z.array(z.string()),
});
export type ReplyStrategy = z.infer<typeof ReplyStrategySchema>;

export const GeneratedResponseSchema = z.object({
  text: z.string(),
  confidence: z.number().min(0).max(1),
  containsSurveyProbe: z.boolean(),
  surveyProbeQuestionId: z.string().optional(),
});
export type GeneratedResponse = z.infer<typeof GeneratedResponseSchema>;
