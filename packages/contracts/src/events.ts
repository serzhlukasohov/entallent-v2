import { z } from 'zod';

export const BaseEventSchema = z.object({
  eventId: z.string().uuid(),
  correlationId: z.string().uuid(),
  causationId: z.string().uuid().optional(),
  traceId: z.string().optional(),
  tenantId: z.string().uuid(),
  occurredAt: z.coerce.date(),
});

const makeEvent = <T extends z.ZodTypeAny>(type: string, payloadSchema: T) =>
  BaseEventSchema.extend({
    type: z.literal(type),
    payload: payloadSchema,
  });

export const ChannelEventReceivedSchema = makeEvent(
  'channel.event.received',
  z.object({
    channel: z.string(),
    rawEvent: z.record(z.unknown()),
    externalEventId: z.string(),
  }),
);

export const MessageNormalizedSchema = makeEvent(
  'message.normalized',
  z.object({
    messageId: z.string().uuid(),
    conversationId: z.string().uuid(),
    userId: z.string().uuid(),
  }),
);

export const MessagePersistedSchema = makeEvent(
  'message.persisted',
  z.object({
    messageId: z.string().uuid(),
    conversationId: z.string().uuid(),
    userId: z.string().uuid(),
  }),
);

export const ConversationResponseRequestedSchema = makeEvent(
  'conversation.response.requested',
  z.object({
    messageId: z.string().uuid(),
    conversationId: z.string().uuid(),
    userId: z.string().uuid(),
  }),
);

export const MessageSendRequestedSchema = makeEvent(
  'message.send.requested',
  z.object({
    outgoingMessageId: z.string().uuid(),
    conversationId: z.string().uuid(),
    userId: z.string().uuid(),
    channel: z.string(),
  }),
);

export const MessageSentSchema = makeEvent(
  'message.sent',
  z.object({
    outgoingMessageId: z.string().uuid(),
    externalMessageId: z.string(),
    sentAt: z.coerce.date(),
  }),
);

export const MemoryExtractionRequestedSchema = makeEvent(
  'memory.extraction.requested',
  z.object({
    messageId: z.string().uuid(),
    conversationId: z.string().uuid(),
    userId: z.string().uuid(),
  }),
);

export const MemoryItemsProposedSchema = makeEvent(
  'memory.items.proposed',
  z.object({
    proposalId: z.string().uuid(),
    userId: z.string().uuid(),
    itemCount: z.number(),
  }),
);

export const MemoryItemsPersistedSchema = makeEvent(
  'memory.items.persisted',
  z.object({
    userId: z.string().uuid(),
    createdCount: z.number(),
    updatedCount: z.number(),
    supersededCount: z.number(),
  }),
);

export const SurveyEvidenceExtractionRequestedSchema = makeEvent(
  'survey.evidence.extraction.requested',
  z.object({
    messageId: z.string().uuid(),
    conversationId: z.string().uuid(),
    userId: z.string().uuid(),
    surveyWindowId: z.string().uuid().optional(),
  }),
);

export const SurveyEvidenceDetectedSchema = makeEvent(
  'survey.evidence.detected',
  z.object({
    surveyWindowId: z.string().uuid(),
    surveyQuestionId: z.string().uuid(),
    evidenceId: z.string().uuid(),
  }),
);

export const SurveyAssessmentUpdatedSchema = makeEvent(
  'survey.assessment.updated',
  z.object({
    surveyWindowId: z.string().uuid(),
    surveyQuestionId: z.string().uuid(),
    assessmentId: z.string().uuid(),
    status: z.string(),
  }),
);

export const RiskAnalysisRequestedSchema = makeEvent(
  'risk.analysis.requested',
  z.object({
    messageId: z.string().uuid(),
    userId: z.string().uuid(),
  }),
);

export const RiskSignalDetectedSchema = makeEvent(
  'risk.signal.detected',
  z.object({
    riskSignalId: z.string().uuid(),
    userId: z.string().uuid(),
    severity: z.enum(['low', 'medium', 'high', 'critical']),
    type: z.string(),
  }),
);

export const FollowUpPlanningRequestedSchema = makeEvent(
  'followup.planning.requested',
  z.object({
    messageId: z.string().uuid(),
    conversationId: z.string().uuid(),
    userId: z.string().uuid(),
  }),
);

export const FollowUpScheduledSchema = makeEvent(
  'followup.scheduled',
  z.object({
    scheduledActionId: z.string().uuid(),
    userId: z.string().uuid(),
    type: z.string(),
    dueAt: z.coerce.date(),
  }),
);

export const FollowUpDueSchema = makeEvent(
  'followup.due',
  z.object({
    scheduledActionId: z.string().uuid(),
    userId: z.string().uuid(),
  }),
);

export const FollowUpCancelledSchema = makeEvent(
  'followup.cancelled',
  z.object({
    scheduledActionId: z.string().uuid(),
    reason: z.string(),
  }),
);

export const HumanEscalationRequestedSchema = makeEvent(
  'human.escalation.requested',
  z.object({
    userId: z.string().uuid(),
    riskSignalId: z.string().uuid().optional(),
    reason: z.string(),
    severity: z.string(),
  }),
);

export type ChannelEventReceived = z.infer<typeof ChannelEventReceivedSchema>;
export type MessageNormalized = z.infer<typeof MessageNormalizedSchema>;
export type MessagePersisted = z.infer<typeof MessagePersistedSchema>;
export type ConversationResponseRequested = z.infer<typeof ConversationResponseRequestedSchema>;
export type MessageSendRequested = z.infer<typeof MessageSendRequestedSchema>;
export type MessageSent = z.infer<typeof MessageSentSchema>;
export type MemoryExtractionRequested = z.infer<typeof MemoryExtractionRequestedSchema>;
export type MemoryItemsProposed = z.infer<typeof MemoryItemsProposedSchema>;
export type MemoryItemsPersisted = z.infer<typeof MemoryItemsPersistedSchema>;
export type SurveyEvidenceExtractionRequested = z.infer<
  typeof SurveyEvidenceExtractionRequestedSchema
>;
export type SurveyEvidenceDetected = z.infer<typeof SurveyEvidenceDetectedSchema>;
export type SurveyAssessmentUpdated = z.infer<typeof SurveyAssessmentUpdatedSchema>;
export type RiskAnalysisRequested = z.infer<typeof RiskAnalysisRequestedSchema>;
export type RiskSignalDetected = z.infer<typeof RiskSignalDetectedSchema>;
export type FollowUpPlanningRequested = z.infer<typeof FollowUpPlanningRequestedSchema>;
export type FollowUpScheduled = z.infer<typeof FollowUpScheduledSchema>;
export type FollowUpDue = z.infer<typeof FollowUpDueSchema>;
export type FollowUpCancelled = z.infer<typeof FollowUpCancelledSchema>;
export type HumanEscalationRequested = z.infer<typeof HumanEscalationRequestedSchema>;
