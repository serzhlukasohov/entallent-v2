import type { RuntimeResult, SituationClassification, RiskDetection } from '@entalent/contracts';
import {
  isRuntimeBoundaryProcessMessageRequest,
  runtimeBoundaryProcessMessageRequestInvalidFields,
} from '../ports/agent-runtime.port';
import type { ProcessMessageRequest, ProcessMessageResult, AgentRuntimePort } from '../ports/agent-runtime.port';
import type { ConversationRepositoryPort } from '../ports/conversation.repository.port';
import type { FeatureFlagPort } from '../ports/feature-flag.port';
import { FEATURE_FLAGS } from '../ports/feature-flag.port';
import type { OutboxPort } from '../ports/outbox.port';
import type { RuntimeActionProposal } from '@entalent/contracts';
import type { RiskSignalRepositoryPort } from '../ports/risk-signal.repository.port';
import type { EscalationPort } from '../ports/escalation.port';
import type { ScheduledActionRepositoryPort } from '../ports/scheduled-action.repository.port';
import type { MemoryRepositoryPort, SaveMemoryItemParams } from '../ports/memory.repository.port';
import type { GoalRepositoryPort } from '../ports/goal.repository.port';
import {
  MafAgentRuntimeConfigurationError,
} from './maf-agent-runtime-client';
import type { MafAgentRuntimeCandidateProvider } from './maf-agent-runtime-client';

const TZ_REFRESH_DAYS = 30;

type OnPostCandidateResult = (context: {
  request: ProcessMessageRequest;
  candidate: RuntimeResult;
  runtimeAttemptId?: string;
}) => Promise<void> | void;

export class MafPrimaryAgentRuntime implements AgentRuntimePort {
  constructor(
    private readonly conversationRepo: ConversationRepositoryPort,
    private readonly outbox: OutboxPort,
    private readonly mafRuntime: MafAgentRuntimeCandidateProvider,
    private readonly featureFlags?: FeatureFlagPort,
    private readonly riskSignalRepo?: RiskSignalRepositoryPort,
    private readonly escalation?: EscalationPort,
    private readonly scheduledActionRepo?: ScheduledActionRepositoryPort,
    private readonly memoryRepo?: MemoryRepositoryPort,
    private readonly goalRepo?: GoalRepositoryPort,
    private readonly onPostCandidateResult?: OnPostCandidateResult,
  ) {}

  async processMessage(
    request: ProcessMessageRequest,
    context?: { runtimeAttemptId?: string },
  ): Promise<ProcessMessageResult> {
    if (!isRuntimeBoundaryProcessMessageRequest(request)) {
      throw new MafAgentRuntimeConfigurationError({
        reasonCode: 'maf_runtime_boundary_request_invalid',
        invalidFields: runtimeBoundaryProcessMessageRequestInvalidFields(request),
      });
    }

    const candidate = await this.mafRuntime.processCandidate(request);
    const conversation = await this.conversationRepo.findById(request.conversationId, request.tenantId);
    if (!conversation) {
      throw new Error(`Conversation ${request.conversationId} not found`);
    }

    const risk = toRiskDetection(candidate.riskAssessment);

    const hasPersistedInboundMessage = request.requestPurpose !== 'proactive_check_in';

    await this.enqueueProfileHydrationIfNeeded(request, conversation);
    if (hasPersistedInboundMessage) {
      await this.persistRiskSideEffects(request, risk);
    }

    const outbound = await this.conversationRepo.saveMessage({
      conversationId: request.conversationId,
      tenantId: request.tenantId,
      userId: request.userId,
      direction: 'outbound',
      text: candidate.reply.text,
      occurredAt: new Date(),
      traceId: request.traceId,
      ...(request.requestPurpose === 'proactive_check_in' ? { messageType: 'proactive_check_in' } : {}),
      metadata: toPrimaryMetadata(candidate, request),
    });

    await this.outbox.enqueueMessageSend({
      messageId: outbound.id,
      tenantId: request.tenantId,
      conversationId: request.conversationId,
      channelType: conversation.channelType,
      externalWorkspaceId: request.externalWorkspaceId,
      externalChannelId: request.externalConversationId,
      text: candidate.reply.text,
      ...(request.conversationThreadId ? { replyToExternalThreadId: request.conversationThreadId } : {}),
    });

    if (hasPersistedInboundMessage) {
      await this.enqueueMafFollowUpProposals(
        candidate,
        request,
        conversation.channelType,
        conversation.userTimezone ?? 'UTC',
      );
      await this.enqueueMafMemoryAndGoalProposals(candidate, request);
      await this.enqueueTypeScriptOwnedExtractionJobs(request, outbound.id, conversation.channelType);
    }
    if (this.onPostCandidateResult) {
      await this.onPostCandidateResult({
        request,
        candidate,
        runtimeAttemptId: context?.runtimeAttemptId,
      });
    }

    const replyMetadata = toReplyMetadata(candidate);
    return {
      outboundMessageId: outbound.id,
      responseText: candidate.reply.text,
      mode: toConversationMode(candidate.reply.mode),
      classification: toPrimaryClassification(candidate),
      risk,
      ...(replyMetadata ? { replyMetadata } : {}),
    };
  }

  private async enqueueMafFollowUpProposals(
    candidate: RuntimeResult,
    request: ProcessMessageRequest,
    channelType: string,
    timezone: string,
  ): Promise<void> {
    if (!this.scheduledActionRepo) {
      return;
    }

    const followUpActions = candidate.proposedActions.filter(
      (action): action is RuntimeFollowUpActionProposal =>
        isFollowUpActionProposal(action) &&
        action.validationResult.status === 'valid' &&
        action.executionStatus === 'not_started',
    );

    for (const action of followUpActions) {
      const dueAt = parseActionDueAt(action.payload.executeAt);
      if (!dueAt) {
        continue;
      }

      try {
        const deduplicationKey = action.payload.deduplicationKey;
        if (await this.scheduledActionRepo.existsByDeduplicationKey(deduplicationKey)) {
          continue;
        }

        const scheduledAction = await this.scheduledActionRepo.save({
          tenantId: request.tenantId,
          userId: request.userId,
          conversationId: request.conversationId,
          type: 'follow_up',
          intent: action.payload.intent,
          context: {
            channelType,
            externalConversationId: request.externalConversationId,
            messageStrategy: 'python-suggested-follow-up',
            topic: action.payload.intent,
            originalReason: action.actionId,
          },
          reason: `Python workflow follow-up action ${action.actionId}`,
          dueAt,
          timezone,
          cancellationConditions: [],
          deduplicationKey,
          sourceMessageIds: [request.messageId],
        });

        await this.outbox.enqueueFollowUpExecution({
          scheduledActionId: scheduledAction.id,
          tenantId: request.tenantId,
          userId: request.userId,
          traceId: `maf-follow-up-${action.actionId}`,
          dueAt,
        });
      } catch {
        // Follow-up scheduling from MAF proposal is best-effort and should not block primary reply.
      }
    }
  }

  private async enqueueMafMemoryAndGoalProposals(
    candidate: RuntimeResult,
    request: ProcessMessageRequest,
  ): Promise<void> {
    await this.enqueueSaveMemoryActions(candidate, request);
    await this.enqueueUpdateGoalActions(candidate, request);
  }

  private async enqueueSaveMemoryActions(
    candidate: RuntimeResult,
    request: ProcessMessageRequest,
  ): Promise<void> {
    if (!this.memoryRepo) {
      return;
    }

    const candidateActions = candidate.proposedActions.filter(
      (action): action is RuntimeSaveMemoryActionProposal =>
        isSaveMemoryActionProposal(action) &&
        action.validationResult.status === 'valid' &&
        action.executionStatus === 'not_started',
    );

    for (const action of candidateActions) {
      const memoryCandidate = candidate.memoryCandidates.find(
        (item) => item.actionId === action.payload.memoryCandidateId,
      );
      if (!memoryCandidate) {
        continue;
      }

      try {
        const canonicalKey = action.payload.memoryCandidateId;
        const existing = await this.memoryRepo.findByCanonicalKey(
          request.userId,
          canonicalKey,
          request.tenantId,
        );
        if (existing) {
          continue;
        }

        const params: SaveMemoryItemParams = {
          tenantId: request.tenantId,
          userId: request.userId,
          category: memoryCandidate.type,
          canonicalKey,
          content: memoryCandidate.content,
          confidence: clamp01(memoryCandidate.confidence),
          importance: clamp01(memoryCandidate.confidence),
          sensitivity: memoryCandidate.sensitivity ?? 'normal',
          sourceMessageIds: normalizeNonEmptyStrings(memoryCandidate.sourceMessageIds),
          extractorVersion: 'maf-primary-proposals',
        };

        await this.memoryRepo.save(params);
      } catch {
        // Memory proposal application is best-effort and should not block the primary reply.
      }
    }
  }

  private async enqueueUpdateGoalActions(
    candidate: RuntimeResult,
    request: ProcessMessageRequest,
  ): Promise<void> {
    if (!this.goalRepo) {
      return;
    }

    const goalActions = candidate.proposedActions.filter(
      (action): action is RuntimeUpdateGoalActionProposal =>
        isUpdateGoalActionProposal(action) &&
        action.validationResult.status === 'valid' &&
        action.executionStatus === 'not_started',
    );

    for (const action of goalActions) {
      const goalId = action.payload.goalId;
      if (!goalId) {
        continue;
      }

      const targetStatus = action.payload.changes?.status;
      if (targetStatus !== 'completed' && targetStatus !== 'cancelled') {
        continue;
      }

      try {
        await this.goalRepo.updateStatus(goalId, targetStatus, request.tenantId);
      } catch {
        // Goal status updates are best-effort and should not block the primary reply.
      }
    }
  }

  private async enqueueProfileHydrationIfNeeded(
    request: ProcessMessageRequest,
    conversation: {
      channelType: string;
      userDisplayName?: string | null;
      userTimezone?: string | null;
      userTimezoneUpdatedAt?: Date | null;
    },
  ): Promise<void> {
    const displayNameMissing = !conversation.userDisplayName;
    const timezoneMissing = !conversation.userTimezone;
    const timezoneStale = Boolean(
      conversation.userTimezoneUpdatedAt &&
        Date.now() - conversation.userTimezoneUpdatedAt.getTime() > TZ_REFRESH_DAYS * 86_400_000,
    );
    if (!displayNameMissing && !timezoneMissing && !timezoneStale) {
      return;
    }

    try {
      await this.outbox.enqueueProfileHydration({
        userId: request.userId,
        tenantId: request.tenantId,
        channelType: conversation.channelType,
        externalWorkspaceId: request.externalWorkspaceId,
        traceId: request.traceId,
      });
    } catch {
      // Profile refresh is non-critical and must not block a primary reply.
    }
  }

  private async persistRiskSideEffects(request: ProcessMessageRequest, risk: RiskDetection): Promise<void> {
    if (risk.riskType && risk.severity !== 'none' && this.riskSignalRepo) {
      await this.riskSignalRepo.save({
        tenantId: request.tenantId,
        userId: request.userId,
        type: risk.riskType,
        severity: risk.severity,
        confidence: risk.confidence,
        evidenceMessageIds: [request.messageId],
        policyVersion: 'v1',
        expiresAt: computeRiskExpiry(risk.severity),
      });
    }

    if ((risk.immediateResponseRequired || risk.severity === 'critical') && this.escalation) {
      await this.escalation.raise({
        type: 'risk_detected',
        severity: risk.severity,
        userId: request.userId,
        tenantId: request.tenantId,
        riskType: risk.riskType,
        messageIds: [request.messageId],
        traceId: request.traceId,
      });
    }
  }

  private async enqueueTypeScriptOwnedExtractionJobs(
    request: ProcessMessageRequest,
    outboundMessageId: string,
    channelType: string,
  ): Promise<void> {
    const flagContext = { tenantId: request.tenantId, userId: request.userId };
    const memoryEnabled = this.featureFlags
      ? await this.featureFlags.isEnabled(FEATURE_FLAGS.MEMORY_EXTRACTION, flagContext)
      : true;
    const surveyEnabled = this.featureFlags
      ? await this.featureFlags.isEnabled(FEATURE_FLAGS.CONVERSATIONAL_SURVEY, flagContext)
      : true;

    if (memoryEnabled) {
      try {
        await this.outbox.enqueueMemoryExtraction({
          conversationId: request.conversationId,
          userId: request.userId,
          tenantId: request.tenantId,
          inboundMessageId: request.messageId,
          outboundMessageId,
          traceId: request.traceId,
          channelType,
          externalConversationId: request.externalConversationId,
        });
        await this.outbox.enqueueStyleAnalysis({
          conversationId: request.conversationId,
          userId: request.userId,
          tenantId: request.tenantId,
          traceId: request.traceId,
        });
      } catch {
        // Auxiliary extraction jobs are retriable by their own queues and must not duplicate the primary reply.
      }
    }

    if (surveyEnabled) {
      try {
        await this.outbox.enqueueSurveyEvidence({
          conversationId: request.conversationId,
          userId: request.userId,
          tenantId: request.tenantId,
          inboundMessageId: request.messageId,
          traceId: request.traceId,
        });
      } catch {
        // Survey extraction is non-critical after the user-facing reply has been queued.
      }
    }
  }
}

type RuntimeFollowUpActionProposal = Extract<
  RuntimeActionProposal,
  {
    aggregateType: 'follow_up';
    actionType: 'schedule_follow_up';
  }
>;

function isFollowUpActionProposal(
  action: RuntimeActionProposal,
): action is RuntimeFollowUpActionProposal {
  return action.aggregateType === 'follow_up' && action.actionType === 'schedule_follow_up';
}

type RuntimeSaveMemoryActionProposal = Extract<
  RuntimeActionProposal,
  {
    aggregateType: 'memory';
    actionType: 'save_memory';
  }
>;

function isSaveMemoryActionProposal(
  action: RuntimeActionProposal,
): action is RuntimeSaveMemoryActionProposal {
  return action.aggregateType === 'memory' && action.actionType === 'save_memory';
}

type RuntimeUpdateGoalActionProposal = Extract<
  RuntimeActionProposal,
  {
    aggregateType: 'goal';
    actionType: 'update_goal';
  }
>;

function isUpdateGoalActionProposal(
  action: RuntimeActionProposal,
): action is RuntimeUpdateGoalActionProposal {
  return action.aggregateType === 'goal' && action.actionType === 'update_goal';
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (value < 0) {
    return 0;
  }
  if (value > 1) {
    return 1;
  }
  return value;
}

function normalizeNonEmptyStrings(values: string[]): string[] {
  const normalized = values.filter((value) => typeof value === 'string' && value.trim().length > 0);
  return normalized.length > 0 ? normalized : ['unknown-message'];
}

function parseActionDueAt(value: string): Date | null {
  const dueAt = new Date(value);
  return Number.isNaN(dueAt.getTime()) ? null : dueAt;
}

function toPrimaryMetadata(candidate: RuntimeResult, request: ProcessMessageRequest): Record<string, unknown> {
  const replyMetadata = toReplyMetadata(candidate);
  const replyPlanMetadata = toReplyPlanMetadata(request);
  return {
    runtimeMode: 'maf_primary',
    runtimeVersion: candidate.diagnostics.runtimeVersion,
    modelCalls: candidate.diagnostics.modelCalls,
    toolCalls: candidate.diagnostics.toolCalls,
    retryCount: candidate.diagnostics.retryCount,
    ...(candidate.diagnostics.replyRenderer ? { replyRenderer: candidate.diagnostics.replyRenderer } : {}),
    proposedActionCount: candidate.proposedActions.length,
    memoryCandidateCount: candidate.memoryCandidates.length,
    proposedActionsDeferred: candidate.proposedActions.length > 0,
    memoryCandidatesDeferred: candidate.memoryCandidates.length > 0,
    ...replyPlanMetadata,
    ...(replyMetadata?.containsSurveyProbe !== undefined
      ? { containsSurveyProbe: replyMetadata.containsSurveyProbe }
      : {}),
    ...(replyMetadata?.surveyProbeQuestionId
      ? { surveyProbeQuestionId: replyMetadata.surveyProbeQuestionId }
      : {}),
  };
}

function toReplyPlanMetadata(request: ProcessMessageRequest): Record<string, unknown> {
  const planning = request.runtimeContext?.replyPlanning;
  const plan = request.runtimeContext?.replyPlan;
  if (!plan) {
    return planning
      ? {
          replyPlanStatus: planning.status,
          ...(planning.reason ? { replyPlanUnavailableReason: planning.reason } : {}),
        }
      : {};
  }

  return {
    replyPlanStatus: planning?.status ?? 'available',
    replyPlanDialogueAct: plan.dialogueAct,
    replyPlanResponseMove: plan.responseMove,
    replyPlanMaxQuestions: plan.questionPolicy.maxQuestions,
    replyPlanQuestionReason: plan.questionPolicy.reason,
  };
}

function toReplyMetadata(candidate: RuntimeResult): ProcessMessageResult['replyMetadata'] {
  const metadata = candidate.reply.metadata;
  if (!metadata) {
    return undefined;
  }

  const replyMetadata = {
    ...(typeof metadata.containsSurveyProbe === 'boolean'
      ? { containsSurveyProbe: metadata.containsSurveyProbe }
      : {}),
    ...(typeof metadata.surveyProbeQuestionId === 'string' && metadata.surveyProbeQuestionId.trim()
      ? { surveyProbeQuestionId: metadata.surveyProbeQuestionId }
      : {}),
  };
  return Object.keys(replyMetadata).length > 0 ? replyMetadata : undefined;
}

function toConversationMode(mode: string | undefined): ProcessMessageResult['mode'] {
  if (mode === 'sensitive' || mode === 'crisis' || mode === 'confirmation') {
    return mode;
  }

  return 'normal';
}

function toPrimaryClassification(
  candidate: RuntimeResult,
): SituationClassification {
  return candidate.classification;
}

function toRiskDetection(risk: RuntimeResult['riskAssessment']): RiskDetection {
  if (!risk) {
    return {
      riskType: null,
      severity: 'none',
      confidence: 0,
      evidence: [],
      immediateResponseRequired: false,
      escalationRecommended: false,
      surveyMustBeBlocked: false,
      proactiveMessagesMustBePaused: false,
      reasoningSummary: 'MAF primary runtime did not return risk assessment.',
    };
  }

  return {
    riskType: toRiskType(risk.type),
    severity: risk.severity,
    confidence: risk.confidence,
    evidence: [],
    immediateResponseRequired: risk.immediateResponseRequired,
    escalationRecommended: risk.escalationRecommended,
    surveyMustBeBlocked: risk.surveyMustBeBlocked,
    proactiveMessagesMustBePaused: risk.proactiveMessagesMustBePaused,
    reasoningSummary: 'maf_primary',
  };
}

const riskTypes = new Set<RiskDetection['riskType']>([
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

function toRiskType(value: string | null): RiskDetection['riskType'] {
  return riskTypes.has(value as RiskDetection['riskType']) ? value as RiskDetection['riskType'] : null;
}

function computeRiskExpiry(severity: string): Date {
  const expiresAt = new Date();
  if (severity === 'critical' || severity === 'high') {
    expiresAt.setDate(expiresAt.getDate() + 90);
    return expiresAt;
  }
  if (severity === 'medium') {
    expiresAt.setDate(expiresAt.getDate() + 30);
    return expiresAt;
  }
  expiresAt.setDate(expiresAt.getDate() + 7);
  return expiresAt;
}
