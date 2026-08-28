import type {
  SituationClassification,
  RiskDetection,
  ReplyStrategy,
  ConversationMode,
} from '@entalent/contracts';
import type { AiProviderPort, ConversationTurn, ResponseContext } from '../ports/ai-provider.port';
import type { ConversationRepositoryPort } from '../ports/conversation.repository.port';
import type { MemoryRepositoryPort } from '../ports/memory.repository.port';
import type { SurveyRepositoryPort } from '../ports/survey.repository.port';
import type { RiskSignalRepositoryPort } from '../ports/risk-signal.repository.port';
import type { ScheduledActionRepositoryPort } from '../ports/scheduled-action.repository.port';
import type { StyleProfileRepositoryPort } from '../ports/style-profile.repository.port';
import type { GoalRepositoryPort } from '../ports/goal.repository.port';
import type {
  ConversationActiveTopicRecord,
  StyleProfileRecord,
  UserGoalRecord,
} from '../types/records';
import { BASE_STYLE, STYLE_CONFIDENCE_FLOOR, STYLE_OFF_BASE_MARGIN } from '../utils/style-adaptation';
import { buildReplyPlan } from '../utils/reply-plan';
import type { EscalationPort } from '../ports/escalation.port';
import type { OutboxPort } from '../ports/outbox.port';
import type { FeatureFlagPort } from '../ports/feature-flag.port';
import { FEATURE_FLAGS } from '../ports/feature-flag.port';
import type { SurveyQuestionRecord } from '../types/records';
import { computeEngagementIndex, computeOpenEndedQuestionScore, computeGroupIndex } from '../utils/group-scoring';
import type { PulseBacklogService } from '../services/pulse-backlog.service';
import { isSessionStart } from '../utils/session';
import { resolveLanguagePolicy } from '../utils/language-policy';
import type {
  ProcessMessageRequest,
  ProcessMessageResult,
} from '../ports/agent-runtime.port';

export type OrchestrateInput = ProcessMessageRequest;
export type OrchestrateResult = ProcessMessageResult;

const TZ_REFRESH_DAYS = 30;
const CONVERSATION_DECISION_MEASUREMENT_VERSION = 'ts-conversation-decision-v1';

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
    private readonly styleProfileRepo?: StyleProfileRepositoryPort,
    private readonly goalRepo?: GoalRepositoryPort,
  ) {}

  async orchestrate(input: OrchestrateInput): Promise<OrchestrateResult> {
    const { conversationId, tenantId, userId, externalWorkspaceId, externalConversationId } =
      input;

    const conversation = await this.conversationRepo.findById(conversationId, tenantId);
    if (!conversation) throw new Error(`Conversation ${conversationId} not found`);
    if (conversation.userId !== userId) {
      throw new Error(`Conversation ${conversationId} does not belong to user ${userId}`);
    }

    const displayNameMissing = !conversation.userDisplayName;
    const tzMissing = !conversation.userTimezone;
    const tzStale = !!conversation.userTimezoneUpdatedAt &&
      Date.now() - conversation.userTimezoneUpdatedAt.getTime() > TZ_REFRESH_DAYS * 86_400_000;
    if (displayNameMissing || tzMissing || tzStale) {
      await this.outbox.enqueueProfileHydration({
        userId,
        tenantId,
        channelType: conversation.channelType,
        externalWorkspaceId,
        traceId: input.traceId,
      });
    }

    const dbMessages = await this.conversationRepo.findRecentMessages(conversationId, 20);
    const currentTurnAt = dbMessages.find((message) => message.id === input.messageId)?.occurredAt
      .toISOString() ?? new Date().toISOString();

    const turns: ConversationTurn[] = dbMessages.map((msg) => ({
      role: msg.direction === 'inbound' ? 'user' : 'assistant',
      content: msg.text,
      timestamp: msg.occurredAt,
    }));

    const userName = conversation.userDisplayName ?? 'there';
    const userTimezone = conversation.userTimezone;
    const flagCtx = { tenantId, userId };

    // ── Group confirmation interpretation (Phase B) ─────────────────────────
    // If the employee is responding to a confirmation the agent surfaced, interpret
    // that reply by meaning and act (agree → score/confirm/report; correct → reopen;
    // unclear → no-op). `awaitingPresent` is true whenever a group was awaiting a
    // reply this turn — used to stop Phase A from surfacing a second confirmation.
    const phaseB = this.surveyRepo
      ? await this.handleAwaitingConfirmation(turns, input)
      : { confirmedGroup: false as string | false, awaitingPresent: false };
    const confirmedGroup = phaseB.confirmedGroup;
    const confirmationHandled = confirmedGroup !== false;

    // Classification and enrichment reads are independent. Goal reads degrade to no goals;
    // relevance is decided later, after safety and confirmation state are known.
    const [rawClassification, [memoryEnabled, surveyEnabled], speculativeMemory, profile, activeGoals] = await Promise.all([
      this.aiProvider.classifySituation(turns, {
        userName,
        now: currentTurnAt,
        timezone: userTimezone,
        continuitySummary: conversation.activeTopic?.summary,
      }),
      Promise.all([
        this.featureFlags ? this.featureFlags.isEnabled(FEATURE_FLAGS.MEMORY_EXTRACTION, flagCtx) : Promise.resolve(true),
        this.featureFlags ? this.featureFlags.isEnabled(FEATURE_FLAGS.CONVERSATIONAL_SURVEY, flagCtx) : Promise.resolve(true),
      ]),
      this.memoryRepo ? this.memoryRepo.findActiveByUser(userId, tenantId, 20) : Promise.resolve([]),
      // Style profile is a non-critical enrichment — a read failure (e.g. table not
      // migrated yet) must never break the reply. Degrade to no adaptation.
      this.styleProfileRepo
        ? this.styleProfileRepo.findByUser(userId, tenantId).catch(() => null)
        : Promise.resolve(null),
      this.goalRepo
        ? this.goalRepo.findActiveByUser(userId, tenantId).catch(() => [])
        : Promise.resolve([]),
    ]);

    // Safety is too important to hinge on one model field. Intents that already route to
    // sensitive/crisis mode force the safety pass deterministically, even if the classifier
    // left requiresSafetyCheck false — otherwise detectRisk silently never runs on a burnout
    // or harassment turn and no risk signal can ever fire.
    const hasSafetyIntent = [rawClassification.primaryIntent, ...rawClassification.secondaryIntents]
      .some((intent) => SAFETY_INTENTS.has(intent));
    let classification: SituationClassification = hasSafetyIntent
      ? { ...rawClassification, requiresSafetyCheck: true }
      : rawClassification;
    const pauseTurn = classification.dialogueAct === 'closing' || classification.dialogueAct === 'acknowledgement';

    const memoryItems = memoryEnabled ? speculativeMemory : [];
    const recentOutbound = dbMessages.filter((m) => m.direction === 'outbound').slice(-2);
    const correctionCarryover = classification.dialogueAct !== 'correction' && recentOutbound.some(
      (message) => message.metadata?.['dialogueAct'] === 'correction',
    );
    const responseMemoryItems = classification.dialogueAct === 'correction' || correctionCarryover
      ? []
      : memoryItems;

    // Blend the user's learned style profile toward the base style, gated on the
    // same flag as memory. Only build adaptation when a profile actually exists.
    // Pass the OBSERVED user style (u) + weight; the renderer decides which axes to
    // nudge (u vs base) and how strongly (scaled by weight). Passing the pre-blended
    // effective level here would damp the signal below the renderer's threshold.
    const styleAdaptation = (memoryEnabled && profile)
      ? { dimensions: profile.dimensions, weight: profile.adaptationWeight, phrases: profile.phrases.map((p) => p.text) }
      : undefined;

    const memoryContextItems = responseMemoryItems
      .filter((item) => item.category !== 'goal')
      .map((item) => ({
        id: item.id,
        category: item.category,
        content: item.content,
        importance: item.importance,
      }));

    // Probe pacing is computable from already-loaded messages — no I/O needed.
    const userTurnCount = dbMessages.filter(
      (m) => m.direction === 'inbound' && m.text !== '__init__',
    ).length;
    const probedRecently = recentOutbound.some(
      (m) => m.metadata?.['containsSurveyProbe'] === true,
    );
    const probePacingAllows = userTurnCount >= 3 && !probedRecently;

    // Risk check and probe lookup are independent — run in parallel.
    // Probe is fetched speculatively when classify says it's allowed; discarded if risk blocks it.
    const speculativeProbeAllowed = !pauseTurn && surveyEnabled && probePacingAllows && classification.surveyAllowed;
    const [risk, speculativeProbe] = await Promise.all([
      classification.requiresSafetyCheck
        ? this.aiProvider.detectRisk(turns, { userName })
        : Promise.resolve(safeDefault()),
      speculativeProbeAllowed ? this.findSurveyProbe(userId, tenantId) : Promise.resolve(null),
    ]);

    // ── Group confirmation surfacing (Phase A) ──────────────────────────────
    // If a group is ripe (pending_confirmation) and none is already awaiting a
    // reply, weave a confirm-only message into THIS reply.
    let confirmationRequest: ResponseContext['confirmationRequest'];
    let surfacedGroup: string | undefined;
    if (this.surveyRepo && !pauseTurn && !confirmationHandled && !phaseB.awaitingPresent) {
      const pending = await this.surveyRepo.findPendingConfirmationGroups(userId);
      if (pending.length > 0) {
        const group = pending[0];
        const evidence = await this.collectGroupEvidence(userId, group.surveyWindowId, group.questionGroup);
        if (evidence.length > 0) {
          confirmationRequest = { questionGroup: group.questionGroup, evidence };
          surfacedGroup = group.questionGroup;
        }
      }
    }

    const continuity = resolveContinuity({
      classification,
      activeTopic: conversation.activeTopic,
      safetyTurn: classification.requiresSafetyCheck || risk.severity !== 'none',
      confirmationTurn: phaseB.awaitingPresent || confirmationRequest !== undefined,
      now: currentTurnAt,
    });
    const continuityDecision = continuity.decision;
    classification = continuity.classification;

    const relevantGoal = selectRelevantGoal(activeGoals, {
      classification,
      risk,
      confirmationTurn: phaseB.awaitingPresent || confirmationRequest !== undefined,
    });
    const goalDecision: {
      selected: boolean;
      selectedGoalId?: string;
      candidateGoalCount: number;
      reason: string;
    } = {
      selected: !!relevantGoal,
      candidateGoalCount: activeGoals.length,
      reason: relevantGoal ? 'exact_active_match' : 'not_selected',
    };
    if (relevantGoal?.id) {
      goalDecision.selectedGoalId = relevantGoal.id;
    }
    const memoryContext = {
      items: memoryContextItems,
      goals: relevantGoal
        ? [{ id: relevantGoal.id, title: relevantGoal.title, status: relevantGoal.status }]
        : [],
    };

    const probeQuestion =
      !confirmationHandled && !confirmationRequest && speculativeProbeAllowed && !risk.surveyMustBeBlocked
        ? speculativeProbe
        : null;

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
            timezone: userTimezone ?? 'UTC',
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

    const baseStrategy = confirmationRequest
      ? { mode: 'confirmation' as const, tone: 'warm' as const, includeFollowUpQuestion: false, maxResponseLength: 'medium' as const, forbiddenPatterns: [] }
      : buildReplyStrategy(classification, risk, probeQuestion?.id);
    const probeStrategy = probeQuestion && baseStrategy.mode !== 'crisis' && baseStrategy.mode !== 'sensitive'
      ? { ...baseStrategy, includeFollowUpQuestion: true }
      : baseStrategy;
    // Verbosity is structural, not a prose hint: for a confident, clearly-terse user,
    // shorten the reply and ask a follow-up only every other turn (A + C) — the coach
    // still engages, just doesn't interrogate a terse person every message.
    const strategyWithStyle = applyTerseStyle(probeStrategy, memoryEnabled ? profile : null);

    const priorMessages = dbMessages.filter((mm) => mm.id !== input.messageId);
    const lastPriorAt = priorMessages.length ? priorMessages[priorMessages.length - 1].occurredAt : undefined;
    const sessionStart = isSessionStart(lastPriorAt, new Date());
    const replyPlan = confirmationRequest
      ? undefined
      : buildReplyPlan({
          classification,
          memoryItems: responseMemoryItems,
          includeFollowUpQuestion: strategyWithStyle.includeFollowUpQuestion,
          correctionCarryover,
          surveyProbeQuestionId: probeQuestion?.id,
          sensitiveMode: strategyWithStyle.mode === 'sensitive' || strategyWithStyle.mode === 'crisis',
        });
    const strategy = replyPlan ? applyReplyPlanToStrategy(strategyWithStyle, replyPlan) : strategyWithStyle;
    const responseProbeQuestion = replyPlan?.questionPolicy.maxQuestions === 0
      ? null
      : probeQuestion;
    const languagePolicy = resolveLanguagePolicy(turns, conversation.userLocale);

    const generated = await this.aiProvider.generateResponse(turns, strategy, {
      userName,
      languagePolicy,
      memoryContext: memoryContext.items.length > 0 || memoryContext.goals.length > 0
        ? memoryContext
        : undefined,
      reminderConfirmation,
      surveyProbeQuestion: responseProbeQuestion
        ? {
            id: responseProbeQuestion.id,
            probeStrategies: responseProbeQuestion.probeStrategies,
            responseType: responseProbeQuestion.responseType,
          }
        : undefined,
      topicConfirmed: typeof confirmedGroup === 'string'
        ? { questionGroup: confirmedGroup }
        : undefined,
      confirmationRequest,
      styleAdaptation,
      localTime: describeLocalTime(conversation.userTimezone),
      isSessionStart: sessionStart,
      replyBrief: replyPlan,
      replyPlan,
    });
    const containsSurveyProbe = !pauseTurn && generated.containsSurveyProbe === true;

    if (continuity.activeTopicUpdate) {
      await this.conversationRepo.updateActiveTopic(
        conversationId,
        tenantId,
        userId,
        continuity.activeTopicUpdate,
      );
    }

    const outbound = await this.conversationRepo.saveMessage({
      conversationId,
      tenantId,
      userId,
      direction: 'outbound',
      text: generated.text,
      occurredAt: new Date(),
      traceId: input.traceId,
      metadata: conversationDecisionMetadata({
        replyPlan,
        responseText: generated.text,
        confirmationRequest: confirmationRequest !== undefined,
        languagePolicy,
        isSessionStart: sessionStart,
        containsSurveyProbe,
        surveyProbeQuestionId: containsSurveyProbe ? generated.surveyProbeQuestionId : undefined,
        continuityDecision,
        goalDecision,
      }),
    });

    if (surfacedGroup && this.surveyRepo) {
      const pending = await this.surveyRepo.findPendingConfirmationGroups(userId);
      const g = pending.find((p) => p.questionGroup === surfacedGroup);
      if (g) {
        await this.surveyRepo.upsertGroupState({
          surveyWindowId: g.surveyWindowId,
          userId: g.userId,
          tenantId: g.tenantId,
          questionGroup: g.questionGroup,
          status: 'awaiting_confirmation',
          aiSummary: g.aiSummary ?? undefined,
        });
      }
    }

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

    if (memoryEnabled) await this.outbox.enqueueStyleAnalysis({
      conversationId,
      userId,
      tenantId,
      traceId: input.traceId,
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

  /**
   * If a group is awaiting a confirmation reply, interpret the employee's latest
   * message by meaning. Returns `awaitingPresent` (true whenever a group was
   * awaiting a reply this turn, so Phase A can avoid surfacing a second
   * confirmation) and `confirmedGroup` (the group name on agreement, so the reply
   * can acknowledge and move on; otherwise false).
   */
  private async handleAwaitingConfirmation(
    turns: ConversationTurn[],
    input: OrchestrateInput,
  ): Promise<{ confirmedGroup: string | false; awaitingPresent: boolean }> {
    if (!this.surveyRepo || !this.outbox) return { confirmedGroup: false, awaitingPresent: false };
    const surveyRepo = this.surveyRepo;

    const awaiting = await surveyRepo.findAwaitingConfirmationGroups(input.userId);
    if (awaiting.length === 0) return { confirmedGroup: false, awaitingPresent: false };
    const group = awaiting[0];

    const verdict = await this.aiProvider.interpretConfirmationResponse(turns, group.aiSummary ?? '');

    if (verdict.verdict === 'unclear') return { confirmedGroup: false, awaitingPresent: true };

    if (verdict.verdict === 'correct') {
      await surveyRepo.upsertGroupState({
        surveyWindowId: group.surveyWindowId,
        userId: group.userId,
        tenantId: group.tenantId,
        questionGroup: group.questionGroup,
        status: 'in_progress',
        aiSummary: group.aiSummary ?? undefined,
      });
      return { confirmedGroup: false, awaitingPresent: true };
    }

    // verdict === 'agree' → compute score, confirm, trigger report
    const employeeScore = await this.computeGroupScore(group.surveyWindowId, group.questionGroup, input.userId);

    await surveyRepo.upsertGroupState({
      surveyWindowId: group.surveyWindowId,
      userId: group.userId,
      tenantId: group.tenantId,
      questionGroup: group.questionGroup,
      status: 'confirmed',
      aiSummary: group.aiSummary ?? undefined,
      employeeScore,
      confirmedAt: new Date(),
    });

    const team = await surveyRepo.findTeamByMemberId(input.userId);
    if (team) {
      await this.outbox.enqueueGroupReport({
        teamId: team.teamId,
        questionGroup: group.questionGroup,
        traceId: `group-report-${group.surveyWindowId}-${group.questionGroup}`,
      });
    }

    return { confirmedGroup: group.questionGroup, awaitingPresent: true };
  }

  /**
   * Compute the employee-level score for a confirmed question group. Preserves the
   * engagement-index vs open-ended branches used by the confirmation flow.
   */
  private async computeGroupScore(
    windowId: string,
    questionGroup: string,
    userId: string,
  ): Promise<number | undefined> {
    if (!this.surveyRepo) return undefined;
    const surveyRepo = this.surveyRepo;

    let employeeScore: number | undefined;
    if (questionGroup === 'engagement') {
      const [questions, assessments] = await Promise.all([
        surveyRepo.findQuestionsForWindow(windowId),
        surveyRepo.findAssessmentsForWindow(windowId),
      ]);
      const engagementQuestionIds = new Set(
        questions
          .filter((question) =>
            question.questionGroup === 'engagement' && question.responseType === 'numeric_0_10')
          .map((question) => question.id),
      );
      const scoreByQuestion = new Map<string, number>();
      for (const assessment of assessments) {
        if (
          engagementQuestionIds.has(assessment.surveyQuestionId) &&
          assessment.status === 'scored' &&
          assessment.score !== null &&
          Number.isFinite(assessment.score) &&
          assessment.score >= 0 &&
          assessment.score <= 10
        ) {
          scoreByQuestion.set(assessment.surveyQuestionId, assessment.score);
        }
      }
      const numericValues = [...scoreByQuestion.values()];
      if (engagementQuestionIds.size === 3 && numericValues.length === 3) {
        employeeScore = computeEngagementIndex(numericValues[0], numericValues[1], numericValues[2]);
      }
    } else {
      const questions = await surveyRepo.findQuestionsForWindow(windowId);
      const groupQs = questions.filter((q) => q.questionGroup === questionGroup);
      const questionScores: number[] = [];
      for (const q of groupQs) {
        const evidence = await surveyRepo.findEvidenceForQuestion(userId, q.id, windowId);
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
    return employeeScore;
  }

  private async collectGroupEvidence(
    userId: string,
    windowId: string,
    questionGroup: string,
  ): Promise<Array<{ stableKey: string; evidenceSummary: string; polarity: string }>> {
    if (!this.surveyRepo) return [];
    const questions = await this.surveyRepo.findQuestionsForWindow(windowId);
    const groupQs = questions.filter((q) => q.questionGroup === questionGroup);
    const out: Array<{ stableKey: string; evidenceSummary: string; polarity: string }> = [];
    for (const q of groupQs) {
      const evidence = await this.surveyRepo.findEvidenceForQuestion(userId, q.id, windowId);
      const latest = [...evidence].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
      if (latest) out.push({ stableKey: q.stableKey, evidenceSummary: latest.evidenceSummary, polarity: latest.polarity });
    }
    return out;
  }

  private async findSurveyProbe(userId: string, tenantId: string): Promise<SurveyQuestionRecord | null> {
    if (!this.pulseBacklogService) return null;
    const result = await this.pulseBacklogService.getNextProbeQuestion(userId, tenantId);
    return result?.question ?? null;
  }
}

const ACTIVE_TOPIC_SUMMARY_MAX_LENGTH = 500;

type ContinuityDecision = {
  action: 'none' | 'park' | 'reuse' | 'replace';
  anchorSource: 'none' | 'stored' | 'new';
  hasSubstance: boolean;
};

function resolveContinuity(input: {
  classification: SituationClassification;
  activeTopic?: ConversationActiveTopicRecord;
  safetyTurn: boolean;
  confirmationTurn: boolean;
  now: string;
}): {
  classification: SituationClassification;
  activeTopicUpdate?: ConversationActiveTopicRecord;
  decision: ContinuityDecision;
} {
  const { activeTopic } = input;
  const dialogueAct = input.classification.dialogueAct;
  const latestSubstance = boundedTopicSummary(input.classification.latestUserSubstance);
  const classifiedAnchor = input.classification.topicAnchor || null;
  const boundedClassifiedAnchor = boundedTopicSummary(classifiedAnchor);
  const usesStoredAnchor = !!activeTopic && classifiedAnchor === activeTopic.summary;
  const resemblesStoredAnchor = !!activeTopic &&
    normalizeExactMatch(boundedClassifiedAnchor) === normalizeExactMatch(activeTopic.summary);
  const withoutTopicAnchor = { ...input.classification, topicAnchor: null };

  if (dialogueAct === 'closing') {
    return {
      classification: withoutTopicAnchor,
      activeTopicUpdate: activeTopic?.status === 'active'
        ? { ...activeTopic, status: 'parked' }
        : undefined,
      decision: {
        action: activeTopic?.status === 'active' ? 'park' : 'none',
        anchorSource: 'none',
        hasSubstance: !!latestSubstance,
      },
    };
  }

  if (
    dialogueAct === 'acknowledgement' ||
    dialogueAct === 'greeting' ||
    dialogueAct === 'social_checkin' ||
    input.safetyTurn ||
    input.confirmationTurn
  ) {
    return {
      classification: withoutTopicAnchor,
      decision: {
        action: 'none',
        anchorSource: 'none',
        hasSubstance: !!latestSubstance,
      },
    };
  }

  if (!latestSubstance) {
    return {
      classification: input.classification,
      decision: {
        action: 'none',
        anchorSource: 'none',
        hasSubstance: false,
      },
    };
  }

  if (activeTopic && usesStoredAnchor) {
    return {
      classification: { ...input.classification, topicAnchor: activeTopic.summary },
      activeTopicUpdate: activeTopic.status === 'parked'
        ? { ...activeTopic, status: 'active' }
        : undefined,
      decision: {
        action: activeTopic.status === 'parked' ? 'reuse' : 'none',
        anchorSource: 'stored',
        hasSubstance: true,
      },
    };
  }

  const summary = dialogueAct === 'continuation' && !resemblesStoredAnchor
    ? boundedClassifiedAnchor ?? latestSubstance
    : latestSubstance;
  return {
    classification: { ...input.classification, topicAnchor: summary },
    activeTopicUpdate: {
      summary,
      status: 'active',
      startedAt: input.now,
    },
    decision: {
      action: 'replace',
      anchorSource: boundedClassifiedAnchor ? 'stored' : 'new',
      hasSubstance: true,
    },
  };
}

function boundedTopicSummary(value: string | null | undefined): string | null {
  const normalized = value?.trim().replace(/\s+/gu, ' ');
  return normalized
    ? [...normalized].slice(0, ACTIVE_TOPIC_SUMMARY_MAX_LENGTH).join('')
    : null;
}

function selectRelevantGoal(
  goals: UserGoalRecord[],
  input: {
    classification: SituationClassification;
    risk: RiskDetection;
    confirmationTurn: boolean;
  },
): UserGoalRecord | undefined {
  const { classification } = input;
  if (
    classification.primaryIntent !== 'progress_update' ||
    !classification.latestUserSubstance?.trim() ||
    classification.requiresSafetyCheck ||
    input.risk.severity !== 'none' ||
    input.confirmationTurn ||
    classification.dialogueAct === 'greeting' ||
    classification.dialogueAct === 'social_checkin' ||
    classification.dialogueAct === 'acknowledgement' ||
    classification.dialogueAct === 'closing'
  ) {
    return undefined;
  }

  const normalizedAnchor = normalizeExactMatch(classification.topicAnchor);
  if (!normalizedAnchor) return undefined;
  return goals
    .filter((goal) => goal.status === 'active' && normalizeExactMatch(goal.title) === normalizedAnchor)
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime() || a.id.localeCompare(b.id))[0];
}

function normalizeExactMatch(value: string | null | undefined): string {
  return value?.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase() ?? '';
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

/** Human-readable local time in the employee's timezone, e.g. "Saturday, 15:30 (afternoon)". */
function describeLocalTime(timezone: string | undefined | null): string | undefined {
  if (!timezone) return undefined;
  try {
    const now = new Date();
    const when = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone, weekday: 'long', hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(now);
    const hour = Number(
      new Intl.DateTimeFormat('en-US', { timeZone: timezone, hour: 'numeric', hour12: false }).format(now),
    );
    const partOfDay = hour < 5 ? 'night' : hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
    return `${when} (${partOfDay})`;
  } catch {
    return undefined;
  }
}

/**
 * Structural style adaptation for verbosity: a confident, clearly-terse user's replies
 * should actually BE short (and drop the forced follow-up), rather than relying on a soft
 * prompt hint the persona overrides. Never touches crisis/sensitive/confirmation turns.
 */
function applyTerseStyle(
  strategy: ReplyStrategy,
  profile: StyleProfileRecord | null,
): ReplyStrategy {
  if (!profile) return strategy;
  if (strategy.mode === 'crisis' || strategy.mode === 'sensitive' || strategy.mode === 'confirmation') return strategy;
  const terse =
    profile.adaptationWeight >= STYLE_CONFIDENCE_FLOOR &&
    BASE_STYLE.verbosity - profile.dimensions.verbosity >= STYLE_OFF_BASE_MARGIN;
  if (!terse) return strategy;
  return { ...strategy, maxResponseLength: 'short' };
}

function applyReplyPlanToStrategy(strategy: ReplyStrategy, plan: ResponseContext['replyPlan']): ReplyStrategy {
  if (!plan || plan.questionPolicy.maxQuestions > 0) return strategy;
  return { ...strategy, includeFollowUpQuestion: false };
}

function replyShapeMetadata(
  plan: ResponseContext['replyPlan'],
  responseText: string,
  confirmationRequest: boolean,
): Record<string, unknown> | undefined {
  if (!plan && !confirmationRequest) return undefined;
  return {
    replyShape: {
      askedQuestion: /[?;՞؟፧᥅⁇⁈⁉⸮﹖？❓❔]/u.test(responseText),
      maxQuestions: plan?.questionPolicy.maxQuestions ?? 1,
      questionPolicyReason: plan?.questionPolicy.reason ?? 'confirmation_requires_question',
    },
  };
}

function conversationDecisionMetadata(input: {
  replyPlan: ResponseContext['replyPlan'];
  responseText: string;
  confirmationRequest: boolean;
  languagePolicy: ResponseContext['languagePolicy'];
  isSessionStart: boolean;
  containsSurveyProbe: boolean;
  surveyProbeQuestionId?: string;
  continuityDecision: ContinuityDecision;
  goalDecision: {
    selected: boolean;
    selectedGoalId?: string;
    candidateGoalCount: number;
    reason: string;
  };
}): Record<string, unknown> {
  const groundingCount = input.replyPlan?.requiredGrounding.length ?? 0;
  return {
    measurementVersion: CONVERSATION_DECISION_MEASUREMENT_VERSION,
    ...(input.replyPlan
      ? {
          dialogueAct: input.replyPlan.dialogueAct,
          responseMove: input.replyPlan.responseMove,
        }
      : {}),
    ...replyShapeMetadata(input.replyPlan, input.responseText, input.confirmationRequest),
    languagePolicy: {
      responseLanguage: input.languagePolicy.responseLanguage,
      source: input.languagePolicy.source,
    },
    isSessionStart: input.isSessionStart,
    memoryGrounding: {
      used: groundingCount > 0,
      count: groundingCount,
    },
    containsSurveyProbe: input.containsSurveyProbe,
    continuityDecision: input.continuityDecision,
    goalDecision: input.goalDecision,
    ...(input.surveyProbeQuestionId
      ? { surveyProbeQuestionId: input.surveyProbeQuestionId }
      : {}),
  };
}

/**
 * Intents that route to sensitive/crisis mode (see modeMap below). The safety pass is forced
 * for these regardless of the classifier's requiresSafetyCheck field, so a single missed flag
 * can never silently skip risk detection on a burnout / harassment / crisis turn.
 */
const SAFETY_INTENTS = new Set<string>(['burnout_signal', 'harassment_signal', 'potential_crisis']);

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
    confirmation: 'warm',
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
