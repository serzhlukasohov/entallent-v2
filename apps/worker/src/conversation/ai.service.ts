import { Injectable, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '@entalent/config';
import { OpenAiProvider } from '@entalent/ai-openai';
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
  ApprovedQuestionRubric,
  QuestionScoreResult,
  QuestionScorerPort,
  QuestionDeidentifierPort,
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

@Injectable()
export class AiService implements AiProviderPort, QuestionScorerPort, QuestionDeidentifierPort {
  private readonly provider: OpenAiProvider;

  constructor(@Inject(ConfigService) private readonly config: ConfigService<Env, true>) {
    const azureEndpoint = this.config.get('AZURE_OPENAI_ENDPOINT', { infer: true });
    if (azureEndpoint) {
      this.provider = new OpenAiProvider({
        azure: true,
        endpoint: azureEndpoint,
        apiKey: this.config.get('AZURE_OPENAI_API_KEY', { infer: true })!,
        apiVersion: this.config.get('AZURE_OPENAI_API_VERSION', { infer: true })!,
        deploymentName: this.config.get('OPENAI_MODEL_BALANCED', { infer: true }) ?? 'gpt-4o',
      });
    } else {
      this.provider = new OpenAiProvider({
        apiKey: this.config.get('OPENAI_API_KEY', { infer: true })!,
      });
    }
  }

  classifySituation(
    turns: ConversationTurn[],
    context: ClassifyContext,
  ): Promise<SituationClassification> {
    return this.provider.classifySituation(turns, context);
  }

  detectRisk(turns: ConversationTurn[], context: RiskContext): Promise<RiskDetection> {
    return this.provider.detectRisk(turns, context);
  }

  extractMemory(turns: ConversationTurn[], existing: MemoryContext): Promise<MemoryProposal> {
    return this.provider.extractMemory(turns, existing);
  }

  evaluateSurveyEvidence(
    turns: ConversationTurn[],
    questions: SurveyQuestionForEvaluation[],
    options?: SurveyEvidenceEvaluationOptions,
  ): Promise<SurveyEvidenceEvaluation> {
    return this.provider.evaluateSurveyEvidence(turns, questions, options);
  }

  scoreConfirmedMeaning(input: {
    semanticSummary: string;
    rubric: ApprovedQuestionRubric;
    questionId: string;
    scoringPolicyVersion: string;
  }): Promise<QuestionScoreResult> {
    return this.provider.scoreConfirmedMeaning(input);
  }

  deidentify(input: { semanticSummary: string; attempt: number }): Promise<string> {
    return this.provider.deidentify(input);
  }

  generateResponse(
    turns: ConversationTurn[],
    strategy: ReplyStrategy,
    context: ResponseContext,
  ): Promise<GeneratedResponse> {
    return this.provider.generateResponse(turns, strategy, context);
  }

  composeQuestionBundle(
    turns: ConversationTurn[],
    questions: Array<{ surveyQuestionId: string; workingSummary: string }>,
    responseLanguage: string,
  ): Promise<QuestionBundleComposition> {
    return this.provider.composeQuestionBundle(turns, questions, responseLanguage);
  }

  interpretQuestionBundleResponse(
    turns: ConversationTurn[],
    bundle: Pick<AwaitingQuestionBundle, 'displayedText' | 'components'>,
  ): Promise<QuestionBundleVerdict> {
    return this.provider.interpretQuestionBundleResponse(turns, bundle);
  }

  composeQuestionClarification(
    turns: ConversationTurn[],
    clarification: Pick<PendingQuestionClarification, 'workingSummary' | 'disputedStatement'>,
    responseLanguage: string,
  ): Promise<string> {
    return this.provider.composeQuestionClarification(turns, clarification, responseLanguage);
  }

  interpretQuestionClarificationResponse(
    turns: ConversationTurn[],
    clarification: Pick<PendingQuestionClarification, 'workingSummary' | 'disputedStatement'>,
  ): Promise<QuestionClarificationVerdict> {
    return this.provider.interpretQuestionClarificationResponse(turns, clarification);
  }

  generateGroupSummary(
    summaries: Array<{ questionId: string; stableKey: string; evidenceSummary: string; polarity: string }>,
    questionGroup: string,
  ): Promise<GroupSummary> {
    return this.provider.generateGroupSummary(summaries, questionGroup);
  }

  generateGroupReport(
    teamSummaries: string[],
    questionGroup: string,
    teamScore: number,
    trend: number | null,
  ): Promise<GroupReport> {
    return this.provider.generateGroupReport(teamSummaries, questionGroup, teamScore, trend);
  }

  interpretConfirmationResponse(
    turns: ConversationTurn[],
    summary: string,
  ): Promise<ConfirmationResponse> {
    return this.provider.interpretConfirmationResponse(turns, summary);
  }

  scoreSentiment(text: string): Promise<number> {
    return this.provider.scoreSentiment(text);
  }

  analyzeStyle(userTurns: string[]): Promise<ObservedStyle> {
    return this.provider.analyzeStyle(userTurns);
  }
}
