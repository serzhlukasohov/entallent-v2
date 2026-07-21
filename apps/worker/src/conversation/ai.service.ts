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

@Injectable()
export class AiService implements AiProviderPort {
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
  ): Promise<SurveyEvidenceEvaluation> {
    return this.provider.evaluateSurveyEvidence(turns, questions);
  }

  generateResponse(
    turns: ConversationTurn[],
    strategy: ReplyStrategy,
    context: ResponseContext,
  ): Promise<GeneratedResponse> {
    return this.provider.generateResponse(turns, strategy, context);
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

  scoreSentiment(text: string): Promise<number> {
    return this.provider.scoreSentiment(text);
  }
}
