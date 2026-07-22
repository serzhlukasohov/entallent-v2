import type {
  SituationClassification,
  RiskDetection,
  ReplyStrategy,
  ConversationMode,
} from '@entalent/contracts';
import type { AiProviderPort, ConversationTurn } from '../ports/ai-provider.port';
import type { ConversationRepositoryPort } from '../ports/conversation.repository.port';
import type { MemoryRepositoryPort } from '../ports/memory.repository.port';
import type { SurveyRepositoryPort } from '../ports/survey.repository.port';
import type { RiskSignalRepositoryPort } from '../ports/risk-signal.repository.port';
import type { ScheduledActionRepositoryPort } from '../ports/scheduled-action.repository.port';
import type { EscalationPort } from '../ports/escalation.port';
import type { OutboxPort } from '../ports/outbox.port';
import type { FeatureFlagPort } from '../ports/feature-flag.port';
import { FEATURE_FLAGS } from '../ports/feature-flag.port';
import type { SurveyQuestionRecord, SurveyGroupStateRecord } from '../types/records';
import { computeEngagementIndex, computeOpenEndedQuestionScore, computeGroupIndex } from '../utils/group-scoring';
import type { PulseBacklogService } from '../services/pulse-backlog.service';

export interface OrchestrateInput {
  messageId: string;
  conversationId: string;
  userId: string;
  tenantId: string;
  externalWorkspaceId: string;
  externalConversationId: string;
  traceId: string;
}

export interface OrchestrateResult {
  outboundMessageId: string;
  responseText: string;
  mode: ConversationMode;
  classification: SituationClassification;
  risk: RiskDetection;
}

export class ConversationOrchestrator {
  constructor(
    private readonly conversationRepo: ConversationRepositoryPort,
    private readonly aiProvider: AiProviderPort,
    private readonly outbox: OutboxPort,
    private readonly memoryRepo?: MemoryRepositoryPort,
    private readonly surveyRepo?: SurveyRepositoryPort,
    private readonly riskSignalRepo?: RiskSignalRepositoryPort,
    private readonly escalation?: EscalationPort,
    private readonly featureFlags?: FeatureFlagPort,
    private readonly scheduledActionRepo?: ScheduledActionRepositoryPort,
    private readonly pulseBacklogService?: PulseBacklogService,
  ) {}

  async orchestrate(input: OrchestrateInput): Promise<OrchestrateResult> {
    const { conversationId, tenantId, userId, externalWorkspaceId, externalConversationId } =
      input;

    const conversation = await this.conversationRepo.findById(conversationId, tenantId);
    if (!conversation) throw new Error(`Conversation ${conversationId} not found`);

    const dbMessages = await this.conversationRepo.findRecentMessages(conversationId, 20);

    const turns: ConversationTurn[] = dbMessages.map((msg) => ({
      role: msg.direction === 'inbound' ? 'user' : 'assistant',
      content: msg.text,
      timestamp: msg.occurredAt,
    }));

    const userName = conversation.userDisplayName ?? 'there';
    const userTimezone = conversation.userTimezone ?? 'UTC';
    const flagCtx = { tenantId, userId };

    // Check for pending group confirmations before classification.
    // If the employee is responding to a confirmation request, intercept and process it.
    const pendingConfirmation = this.surveyRepo
      ? await this.surveyRepo.findPendingConfirmationGroups(input.userId)
      : [];
    const confirmationHandled =
      pendingConfirmation.length > 0
        ? await this.handleGroupConfirmation(pendingConfirmation[0], turns, input)
        : false;

    // Classify, feature flags, and memory load are all independent — run them together.
    // Memory is loaded speculatively (cheap DB read); discarded if feature flag is off.
    const [classification, [memoryEnabled, surveyEnabled], speculativeMemory] = await Promise.all([
      this.aiProvider.classifySituation(turns, {
        userName,
        now: new Date().toISOString(),
        timezone: userTimezone,
      }),
      Promise.all([
        this.featureFlags ? this.featureFlags.isEnabled(FEATURE_FLAGS.MEMORY_EXTRACTION, flagCtx) : Promise.resolve(true),
        this.featureFlags ? this.featureFlags.isEnabled(FEATURE_FLAGS.CONVERSATIONAL_SURVEY, flagCtx) : Promise.resolve(true),
      ]),
      this.memoryRepo ? this.memoryRepo.findActiveByUser(userId, tenantId, 20) : Promise.resolve([]),
    ]);

    const memoryItems = memoryEnabled ? speculativeMemory : [];

    const memoryContext = {
      items: memoryItems.map((i) => ({
        id: i.id,
        category: i.category,
        content: i.content,
        importance: i.importance,
      })),
      goals: memoryItems
        .filter((i) => i.category === 'goal')
        .map((i) => ({ id: i.id, title: i.content, status: i.status })),
    };

    // Probe pacing is computable from already-loaded messages — no I/O needed.
    const userTurnCount = dbMessages.filter(
      (m) => m.direction === 'inbound' && m.text !== '__init__',
    ).length;
    const recentOutbound = dbMessages.filter((m) => m.direction === 'outbound').slice(-2);
    const probedRecently = recentOutbound.some(
      (m) => m.metadata?.['containsSurveyProbe'] === true,
    );
    const probePacingAllows = userTurnCount >= 3 && !probedRecently;

    // Risk check and probe lookup are independent — run in parallel.
    // Probe is fetched speculatively when classify says it's allowed; discarded if risk blocks it.
    const speculativeProbeAllowed = surveyEnabled && probePacingAllows && classification.surveyAllowed;
    const [risk, speculativeProbe] = await Promise.all([
      classification.requiresSafetyCheck
        ? this.aiProvider.detectRisk(turns, { userName })
        : Promise.resolve(safeDefault()),
      speculativeProbeAllowed ? this.findSurveyProbe(userId, tenantId) : Promise.resolve(null),
    ]);

    const probeQuestion =
      !confirmationHandled && speculativeProbeAllowed && !risk.surveyMustBeBlocked ? speculativeProbe : null;

    // Persist risk signal when a real risk is detected
    if (risk.riskType && risk.severity !== 'none' && this.riskSignalRepo) {
      await this.riskSignalRepo.save({
        tenantId,
        userId,
        type: risk.riskType,
        severity: risk.severity,
        confidence: risk.confidence,
        evidenceMessageIds: [input.messageId],
        policyVersion: 'v1',
        expiresAt: computeRiskExpiry(risk.severity),
      });
    }

    // Trigger escalation for critical / immediate-response scenarios
    if ((risk.immediateResponseRequired || risk.severity === 'critical') && this.escalation) {
      await this.escalation.raise({
        type: 'risk_detected',
        severity: risk.severity,
        userId,
        tenantId,
        riskType: risk.riskType,
        messageIds: [input.messageId],
        traceId: input.traceId,
      });
    }

    // Explicit reminder request: create a scheduled action now so the agent can
    // confirm it in this same reply. The reminder fires later via the follow-up queue.
    let reminderConfirmation: { intent: string; dueAt: string } | undefined;
    const reminder = classification.reminderRequest;
    if (reminder && this.scheduledActionRepo) {
      const dueAt = parseReminderDueAt(reminder.dueAt);
      if (dueAt) {
        const dedupKey = `${userId}:user_reminder:${slugify(reminder.intent)}:${dueAt.getTime()}`;
        const alreadyScheduled = await this.scheduledActionRepo.existsByDeduplicationKey(dedupKey);
        if (!alreadyScheduled) {
          const action = await this.scheduledActionRepo.save({
            tenantId,
            userId,
            conversationId,
            type: 'user_reminder',
            intent: reminder.intent,
            context: {
              channelType: conversation.channelType,
              externalConversationId,
              reminderIntent: reminder.intent,
            },
            reason: 'Employee explicitly asked to be reminded',
            dueAt,
            timezone: userTimezone,
            cancellationConditions: [],
            deduplicationKey: dedupKey,
            sourceMessageIds: [input.messageId],
          });
          await this.outbox.enqueueFollowUpExecution({
            scheduledActionId: action.id,
            tenantId,
            userId,
            traceId: `reminder-${action.id}`,
            dueAt,
          });
          reminderConfirmation = { intent: reminder.intent, dueAt: dueAt.toISOString() };
        }
      }
    }

    const strategy = buildReplyStrategy(classification, risk, probeQuestion?.id);

    const generated = await this.aiProvider.generateResponse(turns, strategy, {
      userName,
      memoryContext: memoryItems.length > 0 ? memoryContext : undefined,
      reminderConfirmation,
      surveyProbeQuestion: probeQuestion
        ? { id: probeQuestion.id, probeStrategies: probeQuestion.probeStrategies }
        : undefined,
    });

    const outbound = await this.conversationRepo.saveMessage({
      conversationId,
      tenantId,
      userId,
      direction: 'outbound',
      text: generated.text,
      occurredAt: new Date(),
      traceId: input.traceId,
      metadata: generated.containsSurveyProbe
        ? { containsSurveyProbe: true, surveyProbeQuestionId: generated.surveyProbeQuestionId }
        : undefined,
    });

    await this.outbox.enqueueMessageSend({
      messageId: outbound.id,
      tenantId,
      conversationId,
      channelType: conversation.channelType,
      externalWorkspaceId,
      externalChannelId: externalConversationId,
      text: generated.text,
    });

    if (memoryEnabled) await this.outbox.enqueueMemoryExtraction({
      conversationId,
      userId,
      tenantId,
      inboundMessageId: input.messageId,
      outboundMessageId: outbound.id,
      traceId: input.traceId,
      channelType: conversation.channelType,
      externalConversationId: externalConversationId,
    });

    if (surveyEnabled) await this.outbox.enqueueSurveyEvidence({
      conversationId,
      userId,
      tenantId,
      inboundMessageId: input.messageId,
      traceId: input.traceId,
    });

    return {
      outboundMessageId: outbound.id,
      responseText: generated.text,
      mode: strategy.mode,
      classification,
      risk,
    };
  }

  private async handleGroupConfirmation(
    groupState: SurveyGroupStateRecord,
    turns: ConversationTurn[],
    input: OrchestrateInput,
  ): Promise<boolean> {
    if (!this.aiProvider || !this.surveyRepo || !this.outbox) return false;
    const surveyRepo = this.surveyRepo;

    const lastUserTurn = [...turns].reverse().find((t) => t.role === 'user');
    if (!lastUserTurn) return false;

    // Simple heuristic: look for confirmation keywords in the employee's last message.
    const text = lastUserTurn.content.toLowerCase();
    const CONFIRM_KEYWORDS = ['да', 'yes', 'верно', 'правильно', 'согласен', 'именно', 'точно', 'ок', 'ok', 'correct', 'right', 'sounds good'];
    const isConfirmed = CONFIRM_KEYWORDS.some((kw) => text.includes(kw));

    if (isConfirmed) {
      // Compute employee_score before confirming
      let employeeScore: number | undefined;
      if (groupState.questionGroup === 'engagement') {
        const evidenceItems = await this.surveyRepo.findQuestionsForWindow(groupState.surveyWindowId)
          .then(async (questions) => {
            const groupQs = questions.filter((q) => q.questionGroup === 'engagement');
            const evidenceList = await Promise.all(
              groupQs.map((q) => surveyRepo.findEvidenceForQuestion(input.userId, q.id, groupState.surveyWindowId)),
            );
            return evidenceList.flat();
          });
        const numericValues = evidenceItems
          .filter((e) => e.polarity === 'positive' || e.polarity === 'neutral' || e.polarity === 'negative')
          .slice(0, 3)
          .map((e) => ({ positive: 10, neutral: 5, negative: 0, mixed: 5 }[e.polarity] ?? 5));
        if (numericValues.length === 3) {
          employeeScore = computeEngagementIndex(numericValues[0], numericValues[1], numericValues[2]);
        }
      } else {
        const questions = await this.surveyRepo.findQuestionsForWindow(groupState.surveyWindowId);
        const groupQs = questions.filter((q) => q.questionGroup === groupState.questionGroup);
        const questionScores: number[] = [];
        for (const q of groupQs) {
          const evidence = await this.surveyRepo.findEvidenceForQuestion(input.userId, q.id, groupState.surveyWindowId);
          const latest = [...evidence].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
          if (latest) {
            const sentimentScore = await this.aiProvider.scoreSentiment(latest.evidenceSummary);
            questionScores.push(computeOpenEndedQuestionScore(latest.polarity, sentimentScore));
          }
        }
        if (questionScores.length > 0) {
          employeeScore = computeGroupIndex(questionScores);
        }
      }

      await this.surveyRepo.upsertGroupState({
        surveyWindowId: groupState.surveyWindowId,
        userId: groupState.userId,
        tenantId: groupState.tenantId,
        questionGroup: groupState.questionGroup,
        status: 'confirmed',
        aiSummary: groupState.aiSummary ?? undefined,
        employeeScore,
        confirmedAt: new Date(),
      });

      // Trigger report generation
      const team = await this.surveyRepo.findTeamByMemberId(input.userId);
      if (team) {
        await this.outbox.enqueueGroupReport({
          teamId: team.teamId,
          questionGroup: groupState.questionGroup,
          traceId: `group-report-${groupState.surveyWindowId}-${groupState.questionGroup}`,
        });
      }
    }
    // If needs_correction: GroupConfirmationUseCase will re-run on next cycle
    // (the group state remains pending_confirmation — no change needed here)

    return true; // Signal that this message was a confirmation interaction
  }

  private async findSurveyProbe(userId: string, tenantId: string): Promise<SurveyQuestionRecord | null> {
    if (!this.pulseBacklogService) return null;
    const result = await this.pulseBacklogService.getNextProbeQuestion(userId, tenantId);
    return result?.question ?? null;
  }
}

/** Parse an LLM-provided ISO reminder time; reject invalid or past timestamps. */
function parseReminderDueAt(iso: string): Date | null {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  // Ignore reminders in the past (LLM miscomputed relative time) — nudge to +1 min
  if (d.getTime() <= Date.now()) return new Date(Date.now() + 60_000);
  return d;
}

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, '_').slice(0, 32);
}

function computeRiskExpiry(severity: string): Date {
  const d = new Date();
  if (severity === 'critical' || severity === 'high') d.setDate(d.getDate() + 90);
  else if (severity === 'medium') d.setDate(d.getDate() + 30);
  else d.setDate(d.getDate() + 7);
  return d;
}

function safeDefault(): RiskDetection {
  return {
    riskType: null,
    severity: 'none',
    confidence: 0.99,
    evidence: [],
    immediateResponseRequired: false,
    escalationRecommended: false,
    surveyMustBeBlocked: false,
    proactiveMessagesMustBePaused: false,
    reasoningSummary: 'Safety check not required for this conversation.',
  };
}

function buildReplyStrategy(
  classification: SituationClassification,
  risk: RiskDetection,
  surveyProbeQuestionId?: string,
): ReplyStrategy {
  if (risk.immediateResponseRequired || risk.severity === 'critical') {
    return {
      mode: 'crisis',
      tone: 'empathetic',
      includeFollowUpQuestion: false,
      maxResponseLength: 'short',
      forbiddenPatterns: ['survey', 'goal', 'performance', 'metric'],
    };
  }

  if (risk.severity === 'high') {
    return {
      mode: 'sensitive',
      tone: 'empathetic',
      includeFollowUpQuestion: false,
      maxResponseLength: 'medium',
      forbiddenPatterns: ['survey'],
    };
  }

  const modeMap: Partial<Record<string, ConversationMode>> = {
    support: 'supportive',
    coaching: 'coaching',
    goal_setting: 'coaching',
    progress_update: 'coaching',
    casual_conversation: 'normal',
    celebration: 'celebration',
    onboarding: 'onboarding',
    survey_opportunity: 'survey_probe',
    potential_crisis: 'crisis',
    burnout_signal: 'sensitive',
    harassment_signal: 'sensitive',
  };

  const mode: ConversationMode = modeMap[classification.primaryIntent] ?? 'normal';

  const toneMap: Record<ConversationMode, ReplyStrategy['tone']> = {
    normal: 'professional',
    supportive: 'empathetic',
    coaching: 'warm',
    sensitive: 'empathetic',
    crisis: 'empathetic',
    survey_probe: 'warm',
    proactive_follow_up: 'warm',
    onboarding: 'warm',
    celebration: 'celebratory',
  };

  return {
    mode,
    tone: toneMap[mode],
    includeFollowUpQuestion: ['coaching', 'supportive', 'normal'].includes(mode),
    surveyProbeQuestionId,
    maxResponseLength: classification.urgency === 'high' ? 'short' : 'medium',
    forbiddenPatterns: [],
  };
}
