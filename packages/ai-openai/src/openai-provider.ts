import OpenAI, { AzureOpenAI } from 'openai';
import { CircuitBreaker } from './circuit-breaker';
import {
  SituationClassificationSchema,
  RiskDetectionSchema,
  MemoryProposalSchema,
  GeneratedResponseSchema,
  SurveyEvidenceEvaluationSchema,
  GroupSummarySchema,
  GroupReportSchema,
  SentimentScoreSchema,
  ConfirmationResponseSchema,
  ObservedStyleSchema,
  type SituationClassification,
  type RiskDetection,
  type MemoryProposal,
  type ReplyStrategy,
  type GeneratedResponse,
  type SurveyEvidenceEvaluation,
  type GroupSummary,
  type GroupReport,
  type ConfirmationResponse,
  type ObservedStyle,
} from '@entalent/contracts';
import type {
  AiProviderPort,
  ConversationTurn,
  ClassifyContext,
  RiskContext,
  MemoryContext,
  ResponseContext,
  SurveyQuestionForEvaluation,
} from '@entalent/application';
import { buildClassifySystemPrompt, buildClassifyUserPrompt } from './prompts/classify';
import { buildStyleAnalyzeSystemPrompt, buildStyleAnalyzeUserPrompt } from './prompts/style-analyze';
import { buildMemorySystemPrompt, buildMemoryUserPrompt } from './prompts/memory';
import { buildRiskSystemPrompt, buildRiskUserPrompt } from './prompts/risk';
import { buildRespondSystemPrompt, buildRespondUserPrompt } from './prompts/respond';
import { buildSurveySystemPrompt, buildSurveyUserPrompt } from './prompts/survey';
import { buildGroupConfirmationSystemPrompt, buildGroupConfirmationUserPrompt } from './prompts/group-confirmation';
import { buildConfirmInterpretSystemPrompt, buildConfirmInterpretUserPrompt } from './prompts/confirm-interpret';
import { buildGroupReportSystemPrompt, buildGroupReportUserPrompt } from './prompts/group-report';
import { hasReflectiveOpener } from './prompts/style-antipatterns';

export interface ModelConfig {
  /** Used for classification and risk detection (structured, lower cost). Default: gpt-4o-mini */
  analysis?: string;
  /** Used for response generation (higher quality). Default: gpt-4o */
  generation?: string;
}

export interface DirectOpenAiConfig {
  azure?: false;
  apiKey: string;
  /** Single default model (overrides ModelConfig defaults if set). */
  model?: string;
  models?: ModelConfig;
  organizationId?: string;
}

export interface AzureOpenAiConfig {
  azure: true;
  endpoint: string;
  apiKey: string;
  apiVersion: string;
  /** Azure deployment name — used for both analysis and generation tasks. */
  deploymentName: string;
}

export type OpenAiProviderConfig = DirectOpenAiConfig | AzureOpenAiConfig;

const OPENER_RETRY_INSTRUCTION =
  '\n\nYour previous draft OPENED by labeling what the employee just said (a "verdict on their words"). Do NOT do that. Delete that opening sentence entirely and start with the substance — a specific observation or one sharp question.';

export class OpenAiProvider implements AiProviderPort {
  private readonly client: OpenAI;
  private readonly analysisModel: string;
  private readonly generationModel: string;
  private readonly breaker = new CircuitBreaker({ failureThreshold: 5, windowMs: 60_000, cooldownMs: 30_000 });

  constructor(config: OpenAiProviderConfig) {
    if (config.azure) {
      this.client = new AzureOpenAI({
        endpoint: config.endpoint,
        apiKey: config.apiKey,
        apiVersion: config.apiVersion,
      });
      this.analysisModel = config.deploymentName;
      this.generationModel = config.deploymentName;
    } else {
      this.client = new OpenAI({
        apiKey: config.apiKey,
        organization: config.organizationId,
      });
      const defaultModel = config.model ?? 'gpt-4o-mini';
      this.analysisModel = config.models?.analysis ?? defaultModel;
      this.generationModel = config.models?.generation ?? config.model ?? 'gpt-4o';
    }
  }

  async classifySituation(
    turns: ConversationTurn[],
    context: ClassifyContext,
  ): Promise<SituationClassification> {
    const raw = await this.complete(
      buildClassifySystemPrompt(),
      buildClassifyUserPrompt(turns, context),
      this.analysisModel,
    );
    return SituationClassificationSchema.parse(JSON.parse(raw));
  }

  async detectRisk(turns: ConversationTurn[], context: RiskContext): Promise<RiskDetection> {
    const raw = await this.complete(
      buildRiskSystemPrompt(),
      buildRiskUserPrompt(turns, context),
      this.analysisModel,
    );
    return RiskDetectionSchema.parse(JSON.parse(raw));
  }

  async extractMemory(
    turns: ConversationTurn[],
    existing: MemoryContext,
  ): Promise<MemoryProposal> {
    const raw = await this.complete(
      buildMemorySystemPrompt(),
      buildMemoryUserPrompt(turns, existing),
      this.analysisModel,
      4096,
    );
    return MemoryProposalSchema.parse(JSON.parse(raw));
  }

  async evaluateSurveyEvidence(
    turns: ConversationTurn[],
    questions: SurveyQuestionForEvaluation[],
  ): Promise<SurveyEvidenceEvaluation> {
    const raw = await this.complete(
      buildSurveySystemPrompt(),
      buildSurveyUserPrompt(turns, questions),
      this.analysisModel,
      4096,
    );
    return SurveyEvidenceEvaluationSchema.parse(JSON.parse(raw));
  }

  async generateResponse(
    turns: ConversationTurn[],
    strategy: ReplyStrategy,
    context: ResponseContext,
  ): Promise<GeneratedResponse> {
    const system = buildRespondSystemPrompt(strategy, context);
    const user = buildRespondUserPrompt(turns, context);

    const first = GeneratedResponseSchema.parse(
      JSON.parse(await this.complete(system, user, this.generationModel)),
    );
    // Confirmation replies legitimately open by paraphrasing understanding — exempt them from the gate.
    if (context.confirmationRequest || !hasReflectiveOpener(first.text)) return first;

    // One corrective regeneration — the common path never reaches here.
    return GeneratedResponseSchema.parse(
      JSON.parse(await this.complete(system + OPENER_RETRY_INSTRUCTION, user, this.generationModel)),
    );
  }

  async generateGroupSummary(
    summaries: Array<{ questionId: string; stableKey: string; evidenceSummary: string; polarity: string }>,
    questionGroup: string,
  ): Promise<GroupSummary> {
    const raw = await this.complete(
      buildGroupConfirmationSystemPrompt(questionGroup),
      buildGroupConfirmationUserPrompt(summaries, questionGroup),
      this.analysisModel,
    );
    return GroupSummarySchema.parse(JSON.parse(raw));
  }

  async generateGroupReport(
    teamSummaries: string[],
    questionGroup: string,
    teamScore: number,
    trend: number | null,
  ): Promise<GroupReport> {
    const raw = await this.complete(
      buildGroupReportSystemPrompt(),
      buildGroupReportUserPrompt(teamSummaries, questionGroup, teamScore, trend),
      this.analysisModel,
    );
    return GroupReportSchema.parse(JSON.parse(raw));
  }

  async interpretConfirmationResponse(
    turns: ConversationTurn[],
    summary: string,
  ): Promise<ConfirmationResponse> {
    const raw = await this.complete(
      buildConfirmInterpretSystemPrompt(),
      buildConfirmInterpretUserPrompt(turns, summary),
      this.analysisModel,
      512,
    );
    return ConfirmationResponseSchema.parse(JSON.parse(raw));
  }

  async scoreSentiment(text: string): Promise<number> {
    const raw = await this.complete(
      `Score the sentiment of the following text from 0.0 (very negative) to 1.0 (very positive). Return JSON: {"score": 0.0}`,
      text,
      this.analysisModel,
    );
    return SentimentScoreSchema.parse(JSON.parse(raw)).score;
  }

  async analyzeStyle(userTurns: string[]): Promise<ObservedStyle> {
    const raw = await this.complete(
      buildStyleAnalyzeSystemPrompt(),
      buildStyleAnalyzeUserPrompt(userTurns),
      this.analysisModel,
      1024,
    );
    return ObservedStyleSchema.parse(JSON.parse(raw));
  }

  private async complete(
    systemPrompt: string,
    userPrompt: string,
    model: string,
    maxTokens = 2048,
  ): Promise<string> {
    return this.breaker.call(async () => {
      const response = await this.client.chat.completions.create({
        model,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        response_format: { type: 'json_object' } as any,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.3,
        max_completion_tokens: maxTokens,
      });

      const choice = response.choices[0];
      const content = choice?.message?.content;
      if (!content) throw new Error('OpenAI returned an empty response');
      // A truncated response is invalid JSON — surface it clearly instead of
      // letting JSON.parse throw a cryptic SyntaxError the caller can't diagnose.
      if (choice?.finish_reason === 'length') {
        throw new Error(
          `OpenAI response truncated (finish_reason=length, max_completion_tokens=${maxTokens}) — raise the token budget for this call`,
        );
      }
      return content;
    });
  }
}
