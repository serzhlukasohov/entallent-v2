import type {
  AiProviderPort,
  ConversationTurn,
  ClassifyContext,
  RiskContext,
  MemoryContext,
  ResponseContext,
  SurveyQuestionForEvaluation,
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
  ): Promise<SurveyEvidenceEvaluation> {
    return this.withFallback((p) => p.evaluateSurveyEvidence(turns, questions));
  }

  async generateResponse(
    turns: ConversationTurn[],
    strategy: ReplyStrategy,
    context: ResponseContext,
  ): Promise<GeneratedResponse> {
    return this.withFallback((p) => p.generateResponse(turns, strategy, context));
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
