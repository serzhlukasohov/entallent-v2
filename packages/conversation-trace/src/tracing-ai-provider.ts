import type {
  AiProviderPort,
  AwaitingQuestionBundle,
  ClassifyContext,
  ConversationTurn,
  MemoryContext,
  OrchestrateResult,
  PendingQuestionClarification,
  QuestionBundleComposition,
  QuestionBundleVariant,
  QuestionBundleVerdict,
  QuestionClarificationVerdict,
  ResponseContext,
  RiskContext,
  SurveyQuestionForEvaluation,
} from '@entalent/application';
import type {
  ConfirmationResponse,
  GeneratedResponse,
  GroupReport,
  GroupSummary,
  MemoryProposal,
  ObservedStyle,
  ProviderRiskDetection,
  ReplyStrategy,
  SituationClassification,
  SurveyEvidenceEvaluation,
} from '@entalent/contracts';
import { describeError, type TraceSink } from './events';
import { summarizeValue } from './summarize';

/** One `generateResponse` request: the reply plan and response inputs of the turn come from its context. */
export interface GenerateResponseCall {
  turns: ConversationTurn[];
  strategy: ReplyStrategy;
  context: ResponseContext;
}

/**
 * Model port decorator: forwards every call unchanged and records it as an `llm` event with a
 * readable description of its result, or an `error` event when it throws. `onGenerate` receives
 * each generation request before it runs. A description that throws is dropped, never the call.
 */
export class TracingAiProvider implements AiProviderPort {
  constructor(
    private readonly delegate: AiProviderPort,
    private readonly sink: TraceSink,
    private readonly onGenerate?: (call: GenerateResponseCall) => void,
  ) {}

  classifySituation(turns: ConversationTurn[], context: ClassifyContext): Promise<SituationClassification> {
    return this.traced('classifySituation', this.delegate.classifySituation(turns, context), describeClassification);
  }

  detectRisk(turns: ConversationTurn[], context: RiskContext): Promise<ProviderRiskDetection> {
    return this.traced('detectRisk', this.delegate.detectRisk(turns, context), (risk) =>
      `severity=${risk.severity}${risk.riskType ? ` type=${risk.riskType}` : ''} escalate=${risk.escalationRecommended}`
      + ` blockSurvey=${risk.surveyMustBeBlocked}`);
  }

  extractMemory(turns: ConversationTurn[], existing: MemoryContext): Promise<MemoryProposal> {
    return this.traced('extractMemory', this.delegate.extractMemory(turns, existing), (proposal) =>
      `${proposal.memoryItems.length} memory items, ${proposal.goalProposals.length} goals, `
      + `${proposal.followUpCandidates.length} follow-ups${proposal.memoryItems.length > 0
        ? `: ${summarizeValue(proposal.memoryItems.map((item) => item.content), 0)}` : ''}`);
  }

  evaluateSurveyEvidence(
    turns: ConversationTurn[],
    questions: SurveyQuestionForEvaluation[],
    options?: Parameters<AiProviderPort['evaluateSurveyEvidence']>[2],
  ): Promise<SurveyEvidenceEvaluation> {
    return this.traced('evaluateSurveyEvidence', this.delegate.evaluateSurveyEvidence(turns, questions, options));
  }

  generateResponse(turns: ConversationTurn[], strategy: ReplyStrategy, context: ResponseContext): Promise<GeneratedResponse> {
    if (this.onGenerate) {
      try {
        this.onGenerate({ turns, strategy, context });
      } catch {
        // Capturing the request is diagnostic only.
      }
    }
    return this.traced('generateResponse', this.delegate.generateResponse(turns, strategy, context), (response) =>
      `${describeGenerationRequest(strategy, context)} -> ${response.text.length} chars`);
  }

  composeQuestionBundle(
    turns: ConversationTurn[],
    questions: Array<{ surveyQuestionId: string; workingSummary: string }>,
    responseLanguage: string,
    variant?: QuestionBundleVariant,
  ): Promise<QuestionBundleComposition> {
    return this.traced('composeQuestionBundle', this.delegate.composeQuestionBundle(turns, questions, responseLanguage, variant));
  }

  interpretQuestionBundleResponse(
    turns: ConversationTurn[],
    bundle: Pick<AwaitingQuestionBundle, 'displayedText' | 'components'>,
  ): Promise<QuestionBundleVerdict> {
    return this.traced('interpretQuestionBundleResponse', this.delegate.interpretQuestionBundleResponse(turns, bundle));
  }

  composeQuestionClarification(
    turns: ConversationTurn[],
    clarification: Pick<PendingQuestionClarification, 'workingSummary' | 'disputedStatement'>,
    responseLanguage: string,
  ): Promise<string> {
    return this.traced(
      'composeQuestionClarification',
      this.delegate.composeQuestionClarification(turns, clarification, responseLanguage),
    );
  }

  interpretQuestionClarificationResponse(
    turns: ConversationTurn[],
    clarification: Pick<PendingQuestionClarification, 'workingSummary' | 'disputedStatement'>,
  ): Promise<QuestionClarificationVerdict> {
    return this.traced(
      'interpretQuestionClarificationResponse',
      this.delegate.interpretQuestionClarificationResponse(turns, clarification),
    );
  }

  generateGroupSummary(
    summaries: Array<{ questionId: string; stableKey: string; evidenceSummary: string; polarity: string }>,
    questionGroup: string,
  ): Promise<GroupSummary> {
    return this.traced('generateGroupSummary', this.delegate.generateGroupSummary(summaries, questionGroup));
  }

  generateGroupReport(
    teamSummaries: string[],
    questionGroup: string,
    teamScore: number,
    trend: number | null,
  ): Promise<GroupReport> {
    return this.traced('generateGroupReport', this.delegate.generateGroupReport(teamSummaries, questionGroup, teamScore, trend));
  }

  scoreSentiment(text: string): Promise<number> {
    return this.traced('scoreSentiment', this.delegate.scoreSentiment(text));
  }

  interpretConfirmationResponse(turns: ConversationTurn[], summary: string): Promise<ConfirmationResponse> {
    return this.traced('interpretConfirmationResponse', this.delegate.interpretConfirmationResponse(turns, summary));
  }

  analyzeStyle(userTurns: string[]): Promise<ObservedStyle> {
    return this.traced('analyzeStyle', this.delegate.analyzeStyle(userTurns));
  }

  /** Records the call once it settles, with its result or its error; the outcome itself is passed through. */
  private async traced<T>(
    name: string,
    call: Promise<T>,
    describe: (result: T) => string = (result) => summarizeValue(result, 0),
  ): Promise<T> {
    let result: T;
    try {
      result = await call;
    } catch (error) {
      this.safeRecord(() => ['error', name, describeError(error)]);
      throw error;
    }
    this.safeRecord(() => ['llm', name, describe(result)]);
    return result;
  }

  private safeRecord(build: () => Parameters<TraceSink['record']>): void {
    try {
      if (!this.sink.recording) return;
      this.sink.record(...build());
    } catch {
      // Tracing is diagnostic: a description that cannot be built is dropped.
    }
  }
}

export function describeClassification(classification: SituationClassification): string {
  const parts = [
    `primary=${classification.primaryIntent}`,
    `secondary=[${classification.secondaryIntents.join(', ')}]`,
    `act=${classification.dialogueAct}`,
    `emotion=[${classification.emotionalState.join(', ')}]`,
    `urgency=${classification.urgency}`,
    `safetyCheck=${classification.requiresSafetyCheck}`,
    `surveyAllowed=${classification.surveyAllowed}`,
  ];
  if (classification.latestUserSubstance) parts.push(`substance=${summarizeValue(classification.latestUserSubstance, 1)}`);
  if (classification.reminderRequest) {
    parts.push(`reminder=${summarizeValue(classification.reminderRequest.intent, 1)} at ${classification.reminderRequest.dueAt}`);
  }
  if (classification.onboardingSignal) parts.push(`onboarding=${summarizeValue(classification.onboardingSignal, 1)}`);
  if (classification.formatRequest) parts.push(`format=${summarizeValue(classification.formatRequest, 1)}`);
  if (classification.cycleStatusQuestion) parts.push('cycleStatusQuestion');
  return parts.join(' ');
}

/** Context fields that change what the reply must contain; their presence is the decision. */
const REPLY_OBLIGATIONS = [
  'reportingDisclosure', 'reminderConfirmation', 'topicQuestion', 'surveyProbeQuestion', 'confirmationRequest',
  'trailingBundle', 'topicConfirmed', 'questionNotCollected', 'cycleProgress', 'captureFacts',
] as const;

export function describeGenerationRequest(strategy: ReplyStrategy, context: ResponseContext): string {
  const plan = context.replyPlan;
  const obligations = REPLY_OBLIGATIONS.filter((key) => context[key] !== undefined);
  return [
    `mode=${strategy.mode}`,
    `tone=${strategy.tone}`,
    `length=${strategy.maxResponseLength}`,
    ...(plan ? [`move=${plan.responseMove}`, `maxQuestions=${plan.questionPolicy.maxQuestions}`] : []),
    `language=${context.languagePolicy.responseLanguage}`,
    `must include=[${obligations.join(', ')}]`,
  ].join(' ');
}

export function describeOutcome(result: OrchestrateResult, modelReplied: boolean): string {
  const parts = [
    `mode=${result.mode}`,
    `risk=${result.risk ? `${result.risk.severity}${result.risk.riskType ? `/${result.risk.riskType}` : ''}` : 'not assessed'}`,
    modelReplied ? 'reply written by the model' : 'reply is fixed text (model not called)',
  ];
  if (result.outcome) parts.push(`outcome=${result.outcome}`);
  if (result.bundleReply) parts.push(`bundleReply=${result.bundleReply}`);
  if (result.bundleReplyFallbackReason) parts.push(`bundleFallback=${result.bundleReplyFallbackReason}`);
  if (result.bundleCompositionFallbackReason) parts.push(`compositionFallback=${result.bundleCompositionFallbackReason}`);
  return parts.join(', ');
}
