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
import type { StyleProfileRecord } from '../types/records';
import { BASE_STYLE, STYLE_CONFIDENCE_FLOOR, STYLE_OFF_BASE_MARGIN } from '../utils/style-adaptation';
import { buildReplyPlan } from '../utils/reply-plan';
import type { EscalationPort } from '../ports/escalation.port';
import type { OutboxPort } from '../ports/outbox.port';
import type { FeatureFlagPort } from '../ports/feature-flag.port';
import { FEATURE_FLAGS } from '../ports/feature-flag.port';
import type {
  ReportingDisclosureReceiptRecord,
  SurveyGroupStateRecord,
  SurveyQuestionRecord,
} from '../types/records';
import { computeEngagementIndex, computeOpenEndedQuestionScore, computeGroupIndex } from '../utils/group-scoring';
import type { PulseBacklogService } from '../services/pulse-backlog.service';
import { isSessionStart } from '../utils/session';
import { resolveLanguagePolicy } from '../utils/language-policy';
import {
  REPORTING_DISCLOSURE_VERSION,
  appendReportingDisclosure,
  getReportingDisclosureText,
} from '../utils/reporting-disclosure';
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
  ) {}

  async orchestrate(input: OrchestrateInput): Promise<OrchestrateResult> {
    const { conversationId, tenantId, userId, externalWorkspaceId, externalConversationId } =
      input;

    const conversation = await this.conversationRepo.findById(conversationId, tenantId);
    if (!conversation) throw new Error(`Conversation ${conversationId} not found`);
    if (conversation.tenantId !== tenantId || conversation.userId !== userId) {
      throw new Error(`Conversation ownership mismatch: ${conversationId}`);
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

    const recentMessages = await this.conversationRepo.findRecentMessages(conversationId, 20);
    const inboundMessageIndex = recentMessages.findIndex(
      (message) =>
        message.id === input.messageId
        && message.conversationId === conversationId
        && message.tenantId === tenantId
        && message.userId === userId
        && message.direction === 'inbound',
    );
    if (inboundMessageIndex < 0) {
      throw new Error(`Inbound message ownership mismatch: ${input.messageId}`);
    }

    const dbMessages = recentMessages.slice(0, inboundMessageIndex + 1);
    const inboundMessage = dbMessages[inboundMessageIndex];
    const deliveredReportingDisclosure = this.surveyRepo
      ? await this.conversationRepo.findLatestDeliveredReportingDisclosure(
        tenantId,
        userId,
        REPORTING_DISCLOSURE_VERSION,
        inboundMessage.occurredAt,
      )
      : null;
    const hasCurrentDeliveredDisclosure =
      deliveredReportingDisclosure?.version === REPORTING_DISCLOSURE_VERSION;
    const reportingDisclosureReceipt =
      hasCurrentDeliveredDisclosure
      && deliveredReportingDisclosure.shownAt.getTime() < inboundMessage.occurredAt.getTime()
        ? deliveredReportingDisclosure
        : null;

    const turns: ConversationTurn[] = dbMessages.map((msg) => ({
      role: msg.direction === 'inbound' ? 'user' : 'assistant',
      content: msg.text,
      timestamp: msg.occurredAt,
    }));

    const userName = conversation.userDisplayName ?? 'there';
    const userTimezone = conversation.userTimezone;
    const flagCtx = { tenantId, userId };

    // Classify, feature flags, and memory load are all independent — run them together.
    // Memory is loaded speculatively (cheap DB read); discarded if feature flag is off.
    const [rawClassification, [memoryEnabled, surveyEnabled], speculativeMemory, profile] = await Promise.all([
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
      // Style profile is a non-critical enrichment — a read failure (e.g. table not
      // migrated yet) must never break the reply. Degrade to no adaptation.
      this.styleProfileRepo
        ? this.styleProfileRepo.findByUser(userId, tenantId).catch(() => null)
        : Promise.resolve(null),
    ]);

    // Safety is too important to hinge on one model field. Intents that already route to
    // sensitive/crisis mode force the safety pass deterministically, even if the classifier
    // left requiresSafetyCheck false — otherwise detectRisk silently never runs on a burnout
    // or harassment turn and no risk signal can ever fire.
    const classification: SituationClassification = SAFETY_INTENTS.has(rawClassification.primaryIntent)
      ? { ...rawClassification, requiresSafetyCheck: true }
      : rawClassification;
    const reportingExplanationRequested =
      !(reportingDisclosureReceipt
        && classification.dialogueAct === 'acknowledgement'
        && !classification.latestUserSubstance?.trim())
      && (classification.primaryIntent === 'reporting_explanation'
        || classification.secondaryIntents.includes('reporting_explanation'));
    const closingTurn = classification.dialogueAct === 'closing';
    const pauseTurn = closingTurn || classification.dialogueAct === 'acknowledgement';

    const memoryItems = memoryEnabled ? speculativeMemory : [];

    // Blend the user's learned style profile toward the base style, gated on the
    // same flag as memory. Only build adaptation when a profile actually exists.
    // Pass the OBSERVED user style (u) + weight; the renderer decides which axes to
    // nudge (u vs base) and how strongly (scaled by weight). Passing the pre-blended
    // effective level here would damp the signal below the renderer's threshold.
    const styleAdaptation = (memoryEnabled && profile)
      ? { dimensions: profile.dimensions, weight: profile.adaptationWeight, phrases: profile.phrases.map((p) => p.text) }
      : undefined;

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
    const speculativeProbeAllowed =
      reportingDisclosureReceipt !== null
      && !pauseTurn
      && surveyEnabled
      && probePacingAllows
      && classification.surveyAllowed
      && !reportingExplanationRequested;
    const [risk, speculativeProbe] = await Promise.all([
      classification.requiresSafetyCheck
        ? this.aiProvider.detectRisk(turns, { userName })
        : Promise.resolve(safeDefault()),
      speculativeProbeAllowed ? this.findSurveyProbe(userId, tenantId) : Promise.resolve(null),
    ]);

    // ── Group confirmation interpretation (Phase B) ─────────────────────────
    // Safety classification must resolve before any survey state can change.
    const phaseB = this.surveyRepo && surveyEnabled
      && classification.surveyAllowed && !risk.surveyMustBeBlocked
      ? await this.handleAwaitingConfirmation(
        turns,
        input,
        reportingExplanationRequested ? null : reportingDisclosureReceipt,
        inboundMessage?.occurredAt,
      )
      : { confirmedGroup: false as string | false, awaitingPresent: false };
    const confirmedGroup = phaseB.confirmedGroup;
    const confirmationHandled = confirmedGroup !== false;

    // ── Group confirmation surfacing (Phase A) ──────────────────────────────
    // If a group is ripe (pending_confirmation) and none is already awaiting a
    // reply, weave a confirm-only message into THIS reply.
    let confirmationRequest: ResponseContext['confirmationRequest'];
    let surfacedGroup: SurveyGroupStateRecord | undefined;
    if (
      this.surveyRepo
      && reportingDisclosureReceipt
      && !closingTurn
      && surveyEnabled
      && classification.surveyAllowed
      && !risk.surveyMustBeBlocked
      && !reportingExplanationRequested
      && !confirmationHandled
      && !phaseB.awaitingPresent
    ) {
      const pending = await this.surveyRepo.findPendingConfirmationGroups(userId, tenantId);
      if (pending.length > 0) {
        const group = pending[0];
        const evidence = await this.collectGroupEvidence(userId, group.surveyWindowId, group.questionGroup);
        if (evidence.length > 0) {
          confirmationRequest = { questionGroup: group.questionGroup, evidence };
          surfacedGroup = group;
        }
      }
    }

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
    // Verbosity is structural, not a prose hint: for a confident, clearly-terse user,
    // shorten the reply and ask a follow-up only every other turn (A + C) — the coach
    // still engages, just doesn't interrogate a terse person every message.
    const strategyWithStyle = applyTerseStyle(baseStrategy, memoryEnabled ? profile : null);

    const priorMessages = dbMessages.filter((mm) => mm.id !== input.messageId);
    const lastPriorAt = priorMessages.length ? priorMessages[priorMessages.length - 1].occurredAt : undefined;
    const sessionStart = isSessionStart(lastPriorAt, new Date());
    const replyPlan = confirmationRequest
      ? undefined
      : buildReplyPlan({
          classification,
          memoryItems,
          includeFollowUpQuestion: strategyWithStyle.includeFollowUpQuestion,
          surveyProbeQuestionId: probeQuestion?.id,
          sensitiveMode: strategyWithStyle.mode === 'sensitive' || strategyWithStyle.mode === 'crisis',
        });
    const strategy = replyPlan ? applyReplyPlanToStrategy(strategyWithStyle, replyPlan) : strategyWithStyle;
    const languagePolicy = resolveLanguagePolicy(turns, conversation.userLocale);

    const shouldOfferReportingDisclosure =
      this.surveyRepo !== undefined
      && surveyEnabled
      && !hasCurrentDeliveredDisclosure
      && !pauseTurn
      && classification.surveyAllowed
      && !risk.surveyMustBeBlocked
      && strategy.mode !== 'crisis'
      && strategy.mode !== 'sensitive'
      && (reportingExplanationRequested || probePacingAllows || phaseB.awaitingPresent);
    const canAnswerReportingExplanation =
      reportingExplanationRequested
      && classification.surveyAllowed
      && !risk.surveyMustBeBlocked
      && strategy.mode !== 'sensitive'
      && strategy.mode !== 'crisis';
    const generated = canAnswerReportingExplanation
      ? {
          text: getReportingDisclosureText(languagePolicy.responseLanguage),
          confidence: 1,
          containsSurveyProbe: false,
        }
      : await this.aiProvider.generateResponse(turns, strategy, {
      userName,
      languagePolicy,
      memoryContext: memoryItems.length > 0 ? memoryContext : undefined,
      reportingDisclosure: shouldOfferReportingDisclosure
        ? getReportingDisclosureText(languagePolicy.responseLanguage)
        : undefined,
      reminderConfirmation,
      surveyProbeQuestion: probeQuestion
        ? { id: probeQuestion.id, probeStrategies: probeQuestion.probeStrategies }
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
    const shouldAppendReportingDisclosure = shouldOfferReportingDisclosure;
    const responseText = shouldAppendReportingDisclosure
      ? appendReportingDisclosure(generated.text, languagePolicy.responseLanguage)
      : generated.text;
    const confirmationSummary = confirmationRequest ? generated.confirmationSummary : undefined;
    if (
      confirmationRequest
      && (
        !confirmationSummary?.trim()
        || confirmationSummary.trim() === responseText.trim()
        || !responseText.includes(confirmationSummary)
        || exposesConfirmationSummaryLabel(responseText)
      )
    ) {
      throw new Error('Confirmation response requires a non-empty confirmationSummary copied verbatim as a proper substring of text');
    }
    const containsSurveyProbe =
      probeQuestion !== null
      && !pauseTurn
      && generated.containsSurveyProbe === true;

    const outbound = await this.conversationRepo.saveMessage({
      conversationId,
      tenantId,
      userId,
      direction: 'outbound',
      text: responseText,
      occurredAt: new Date(),
      traceId: input.traceId,
      metadata: {
        ...conversationDecisionMetadata({
          replyPlan,
          responseText,
          confirmationRequest: confirmationRequest !== undefined,
          languagePolicy,
          isSessionStart: sessionStart,
          containsSurveyProbe,
          surveyProbeQuestionId: containsSurveyProbe ? generated.surveyProbeQuestionId : undefined,
        }),
        ...(shouldAppendReportingDisclosure
          ? { reportingDisclosureVersion: REPORTING_DISCLOSURE_VERSION }
          : {}),
        ...(confirmationSummary ? { confirmationSummary } : {}),
      },
    });

    if (surfacedGroup && this.surveyRepo) {
      const staged = await this.surveyRepo.stageGroupConfirmation({
        surveyWindowId: surfacedGroup.surveyWindowId,
        conversationId,
        userId: surfacedGroup.userId,
        tenantId: surfacedGroup.tenantId,
        questionGroup: surfacedGroup.questionGroup,
        expectedUpdatedAt: surfacedGroup.updatedAt,
        confirmationPromptMessageId: outbound.id,
      });
      if (!staged) {
        throw new Error(`Confirmation candidate became stale: ${surfacedGroup.questionGroup}`);
      }
    }

    await this.outbox.enqueueMessageSend({
      messageId: outbound.id,
      tenantId,
      conversationId,
      channelType: conversation.channelType,
      externalWorkspaceId,
      externalChannelId: externalConversationId,
      text: responseText,
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
      responseText,
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
    reportingDisclosureReceipt: ReportingDisclosureReceiptRecord | null,
    confirmingMessageOccurredAt?: Date,
  ): Promise<{ confirmedGroup: string | false; awaitingPresent: boolean }> {
    if (!this.surveyRepo || !this.outbox) return { confirmedGroup: false, awaitingPresent: false };
    const surveyRepo = this.surveyRepo;

    const awaiting = await surveyRepo.findAwaitingConfirmationGroups(
      input.userId,
      input.tenantId,
      input.conversationId,
    );
    if (awaiting.length === 0) return { confirmedGroup: false, awaitingPresent: false };
    if (!reportingDisclosureReceipt || !confirmingMessageOccurredAt) {
      await Promise.all(
        awaiting.map((group) =>
          surveyRepo.transitionAwaitingGroupState({
            surveyWindowId: group.surveyWindowId,
            userId: group.userId,
          tenantId: group.tenantId,
          questionGroup: group.questionGroup,
          confirmationPromptMessageId: group.confirmationPromptMessageId!,
          status: 'pending_confirmation',
          }),
        ),
      );
      return { confirmedGroup: false, awaitingPresent: true };
    }

    const group = awaiting[0];
    if (!group.confirmationSummary || !group.confirmationPromptMessageId) {
      return { confirmedGroup: false, awaitingPresent: true };
    }

    const verdict = await this.aiProvider.interpretConfirmationResponse(turns, group.confirmationSummary);

    if (verdict.verdict === 'unclear') return { confirmedGroup: false, awaitingPresent: true };

    if (verdict.verdict === 'correct') {
      await surveyRepo.transitionAwaitingGroupState({
        surveyWindowId: group.surveyWindowId,
        userId: group.userId,
      tenantId: group.tenantId,
      questionGroup: group.questionGroup,
      confirmationPromptMessageId: group.confirmationPromptMessageId,
      status: 'in_progress',
      conversationId: input.conversationId,
      responseMessageId: input.messageId,
      responseOccurredAt: confirmingMessageOccurredAt,
    });
      return { confirmedGroup: false, awaitingPresent: true };
    }

    // verdict === 'agree' → compute score, confirm, trigger report
    const employeeScore = await this.computeGroupScore(group.surveyWindowId, group.questionGroup, input.userId);

    const confirmed = await surveyRepo.confirmGroupState({
      surveyWindowId: group.surveyWindowId,
      conversationId: input.conversationId,
      userId: group.userId,
      tenantId: group.tenantId,
      questionGroup: group.questionGroup,
      confirmationPromptMessageId: group.confirmationPromptMessageId,
      expectedConfirmationSummary: group.confirmationSummary,
      employeeScore,
      confirmedAt: confirmingMessageOccurredAt,
      reportingDisclosureVersion: reportingDisclosureReceipt.version,
      reportingDisclosureShownAt: reportingDisclosureReceipt.shownAt,
      confirmationMessageId: input.messageId,
    });

    if (!confirmed) return { confirmedGroup: false, awaitingPresent: true };

    const team = await surveyRepo.findTeamByMemberId(input.userId, input.tenantId);
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
      const evidenceItems = await surveyRepo.findQuestionsForWindow(windowId)
        .then(async (questions) => {
          const groupQs = questions.filter((q) => q.questionGroup === 'engagement');
          const evidenceList = await Promise.all(
            groupQs.map((q) => surveyRepo.findEvidenceForQuestion(userId, q.id, windowId)),
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

/** Parse an LLM-provided ISO reminder time; reject invalid or past timestamps. */
function parseReminderDueAt(iso: string): Date | null {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  // Ignore reminders in the past (LLM miscomputed relative time) — nudge to +1 min
  if (d.getTime() <= Date.now()) return new Date(Date.now() + 60_000);
  return d;
}

function exposesConfirmationSummaryLabel(text: string): boolean {
  return /\bconfirmationSummary\s*:/i.test(text);
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
