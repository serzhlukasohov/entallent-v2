import OpenAI, { AzureOpenAI } from 'openai';
import { CircuitBreaker } from './circuit-breaker';
import {
  SituationClassificationSchema,
  RiskDetectionSchema,
  MemoryProposalSchema,
  GeneratedResponseSchema,
  SurveyEvidenceEvaluationSchema,
  type SituationClassification,
  type RiskDetection,
  type MemoryProposal,
  type ReplyStrategy,
  type GeneratedResponse,
  type SurveyEvidenceEvaluation,
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
import { buildMemorySystemPrompt, buildMemoryUserPrompt } from './prompts/memory';
import { buildRiskSystemPrompt, buildRiskUserPrompt } from './prompts/risk';
import { buildRespondSystemPrompt, buildRespondUserPrompt } from './prompts/respond';
import { buildSurveySystemPrompt, buildSurveyUserPrompt } from './prompts/survey';

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
    );
    return SurveyEvidenceEvaluationSchema.parse(JSON.parse(raw));
  }

  async generateResponse(
    turns: ConversationTurn[],
    strategy: ReplyStrategy,
    context: ResponseContext,
  ): Promise<GeneratedResponse> {
    const raw = await this.complete(
      buildRespondSystemPrompt(strategy, context),
      buildRespondUserPrompt(turns, context),
      this.generationModel,
    );
    return GeneratedResponseSchema.parse(JSON.parse(raw));
  }

  private async complete(systemPrompt: string, userPrompt: string, model: string): Promise<string> {
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
        max_completion_tokens: 1024,
      });

      const content = response.choices[0]?.message?.content;
      if (!content) throw new Error('OpenAI returned an empty response');
      return content;
    });
  }
}
