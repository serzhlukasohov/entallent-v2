import type {
  AiProviderPort,
  ConversationTurn,
  ClassifyContext,
  RiskContext,
  MemoryContext,
  ResponseContext,
  SurveyQuestionForEvaluation,
  SurveyEvidenceEvaluationOptions,
  QuestionBundleComposition,
  AwaitingQuestionBundle,
  QuestionBundleVerdict,
  PendingQuestionClarification,
  QuestionClarificationVerdict,
} from '@entalent/application';
import type {
  SituationClassification,
  RiskDetection,
  MemoryProposal,
  ReplyStrategy,
  GeneratedResponse,
  SurveyEvidenceEvaluation,
  GroupSummary,
  GroupReport,
  ConfirmationResponse,
  ObservedStyle,
} from '@entalent/contracts';

/**
 * Wraps a primary provider with one or more fallbacks.
 * On any error from the primary, each fallback is tried in order.
 * Use this to route between OpenAI and an alternative (e.g., Anthropic, local model).
 */
export class AiProviderWithFallback implements AiProviderPort {
  private readonly providers: AiProviderPort[];

  constructor(primary: AiProviderPort, ...fallbacks: AiProviderPort[]) {
    this.providers = [primary, ...fallbacks];
  }

  async classifySituation(
    turns: ConversationTurn[],
    context: ClassifyContext,
  ): Promise<SituationClassification> {
    return this.withFallback((p) => p.classifySituation(turns, context));
  }

  async detectRisk(turns: ConversationTurn[], context: RiskContext): Promise<RiskDetection> {
    return this.withFallback((p) => p.detectRisk(turns, context));
  }

  async extractMemory(turns: ConversationTurn[], existing: MemoryContext): Promise<MemoryProposal> {
    return this.withFallback((p) => p.extractMemory(turns, existing));
  }

  async evaluateSurveyEvidence(
    turns: ConversationTurn[],
    questions: SurveyQuestionForEvaluation[],
    options?: SurveyEvidenceEvaluationOptions,
  ): Promise<SurveyEvidenceEvaluation> {
    return this.withFallback((p) => p.evaluateSurveyEvidence(turns, questions, options));
  }

  async generateResponse(
    turns: ConversationTurn[],
    strategy: ReplyStrategy,
    context: ResponseContext,
  ): Promise<GeneratedResponse> {
    return this.withFallback((p) => p.generateResponse(turns, strategy, context));
  }

  async composeQuestionBundle(
    turns: ConversationTurn[],
    questions: Array<{ surveyQuestionId: string; workingSummary: string }>,
    responseLanguage: string,
  ): Promise<QuestionBundleComposition> {
    return this.withFallback((provider) => provider.composeQuestionBundle(turns, questions, responseLanguage));
  }

  async interpretQuestionBundleResponse(
    turns: ConversationTurn[],
    bundle: Pick<AwaitingQuestionBundle, 'displayedText' | 'components'>,
  ): Promise<QuestionBundleVerdict> {
    return this.withFallback((provider) => provider.interpretQuestionBundleResponse(turns, bundle));
  }

  async composeQuestionClarification(
    turns: ConversationTurn[],
    clarification: Pick<PendingQuestionClarification, 'workingSummary' | 'disputedStatement'>,
    responseLanguage: string,
  ): Promise<string> {
    return this.withFallback((provider) => provider.composeQuestionClarification(turns, clarification, responseLanguage));
  }

  async interpretQuestionClarificationResponse(
    turns: ConversationTurn[],
    clarification: Pick<PendingQuestionClarification, 'workingSummary' | 'disputedStatement'>,
  ): Promise<QuestionClarificationVerdict> {
    return this.withFallback((provider) => provider.interpretQuestionClarificationResponse(turns, clarification));
  }

  async generateGroupSummary(
    summaries: Array<{ questionId: string; stableKey: string; evidenceSummary: string; polarity: string }>,
    questionGroup: string,
  ): Promise<GroupSummary> {
    return this.withFallback((p) => p.generateGroupSummary(summaries, questionGroup));
  }

  async generateGroupReport(
    teamSummaries: string[],
    questionGroup: string,
    teamScore: number,
    trend: number | null,
  ): Promise<GroupReport> {
    return this.withFallback((p) => p.generateGroupReport(teamSummaries, questionGroup, teamScore, trend));
  }

  async scoreSentiment(text: string): Promise<number> {
    return this.withFallback((p) => p.scoreSentiment(text));
  }

  async interpretConfirmationResponse(
    turns: ConversationTurn[],
    summary: string,
  ): Promise<ConfirmationResponse> {
    return this.withFallback((p) => p.interpretConfirmationResponse(turns, summary));
  }

  async analyzeStyle(userTurns: string[]): Promise<ObservedStyle> {
    return this.withFallback((p) => p.analyzeStyle(userTurns));
  }

  private async withFallback<T>(call: (provider: AiProviderPort) => Promise<T>): Promise<T> {
    let lastError: unknown;
    for (const provider of this.providers) {
      try {
        return await call(provider);
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError;
  }
}
