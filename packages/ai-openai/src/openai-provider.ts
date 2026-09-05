import OpenAI, { AzureOpenAI } from 'openai';
import { CircuitBreaker } from './circuit-breaker';
import {
  SituationClassificationSchema,
  SituationIntentSchema,
  DialogueActSchema,
  RiskDetectionSchema,
  MemoryItemProposalSchema,
  GoalProposalSchema,
  FollowUpCandidateSchema,
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

function questionRetryInstruction(maxQuestions: 0 | 1): string {
  return maxQuestions === 0
    ? '\n\nYour previous draft asked a question. This turn must ask none — rewrite without any question anywhere in the reply.'
    : '\n\nYour previous draft asked more than one question. Rewrite with at most one question in the entire reply.';
}

const CONFIRMATION_RETRY_INSTRUCTION =
  '\n\nYour previous confirmation draft was invalid. Return a non-empty reportable "confirmationSummary" with no question punctuation, copy that exact byte-for-byte string into "text" as a proper substring (never the entire reply), do not expose field labels like "confirmationSummary:", and ask exactly one question in the full "text" outside that summary.';

function exposesConfirmationSummaryLabel(text: string): boolean {
  return /\bconfirmationSummary\s*:/i.test(text);
}

function isValidConfirmationResponse(response: GeneratedResponse): boolean {
  const summary = response.confirmationSummary;
  return typeof summary === 'string'
    && summary.trim().length > 0
    && summary.trim() !== response.text.trim()
    && response.text.includes(summary)
    && !exposesConfirmationSummaryLabel(response.text)
    && countQuestionGroups(summary) === 0
    && countQuestionGroups(response.text) === 1;
}

/** Firm rewrite instruction when a reply overruns its length budget. */
function lengthRetryInstruction(maxChars: number): string {
  const words = Math.max(8, Math.round(maxChars / 6));
  return `\n\nYour previous draft was too long for this turn. Rewrite it much shorter — at most ${words} words, one sentence if you can. Keep only the single most useful thing and drop the extra observation.`;
}

/**
 * Hard length ceiling (characters) per reply-length tier, tightened for a clearly terse
 * user. Verbosity comes from the observed style profile already carried in the response context.
 */
function maxReplyChars(strategy: ReplyStrategy, context: ResponseContext): number {
  const verbosity = context.styleAdaptation?.dimensions.verbosity;
  const terse = typeof verbosity === 'number' && verbosity <= 0.3;
  switch (strategy.maxResponseLength) {
    case 'short':
      return terse ? 140 : 360;
    case 'medium':
      return terse ? 340 : 680;
    default:
      return 980;
  }
}

function countQuestionGroups(text: string): number {
  return text.match(/[?;՞؟፧᥅⁇⁈⁉⸮﹖？❓❔]+/gu)?.length ?? 0;
}

function maxAllowedQuestions(strategy: ReplyStrategy, context: ResponseContext): 0 | 1 {
  const replyPlan = context.replyPlan ?? context.replyBrief;
  if (replyPlan) return replyPlan.questionPolicy.maxQuestions;
  return strategy.includeFollowUpQuestion || context.proactiveCheckIn ? 1 : 0;
}

/** Structural shape of a Zod schema's safeParse — lets keepValid stay decoupled from zod. */
type SafeParser<T> = { safeParse(input: unknown): { success: true; data: T } | { success: false } };

/**
 * Validate an array of untrusted model output element-by-element, keeping only the items that
 * parse and silently dropping the rest. A single malformed item (e.g. a hallucinated enum
 * value) must never discard the whole batch or throw.
 */
function keepValid<T>(value: unknown, schema: SafeParser<T>): T[] {
  if (!Array.isArray(value)) return [];
  const out: T[] = [];
  for (const item of value) {
    const result = schema.safeParse(item);
    if (result.success) out.push(result.data);
  }
  return out;
}

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
      2048,
      0,
    );
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      const record = parsed as Record<string, unknown>;
      if (
        !SituationIntentSchema.safeParse(record['primaryIntent']).success &&
        DialogueActSchema.safeParse(record['primaryIntent']).success &&
        DialogueActSchema.safeParse(record['dialogueAct']).success
      ) {
        record['primaryIntent'] = 'casual_conversation';
      }
    }
    return SituationClassificationSchema.parse(parsed);
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
    const parsed: unknown = JSON.parse(raw);
    const obj: Record<string, unknown> =
      parsed !== null && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
    // The model occasionally emits a near-miss category ("stressors" for "stressor") or an
    // otherwise malformed item. Drop the offending items rather than throwing away the whole
    // extraction — one bad field must not lose every memory from the turn or crash the job.
    return {
      memoryItems: keepValid(obj['memoryItems'], MemoryItemProposalSchema),
      goalProposals: keepValid(obj['goalProposals'], GoalProposalSchema),
      commitmentProposals: Array.isArray(obj['commitmentProposals'])
        ? (obj['commitmentProposals'] as unknown[]).filter(
            (v): v is Record<string, unknown> => typeof v === 'object' && v !== null,
          )
        : [],
      followUpCandidates: keepValid(obj['followUpCandidates'], FollowUpCandidateSchema),
    };
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

    // Deterministic invariants the persona won't respect from a soft prompt hint. Collect
    // what fired, do ONE corrective regeneration, then fail closed on an invalid confirmation.
    const retries: string[] = [];
    if (context.confirmationRequest) {
      if (!isValidConfirmationResponse(first)) retries.push(CONFIRMATION_RETRY_INSTRUCTION);
    } else {
      if (first.text.length > maxReplyChars(strategy, context)) {
        retries.push(lengthRetryInstruction(maxReplyChars(strategy, context)));
      }
      const maxQuestions = maxAllowedQuestions(strategy, context);
      if (countQuestionGroups(first.text) > maxQuestions) {
        retries.push(questionRetryInstruction(maxQuestions));
      }
    }
    if (retries.length === 0) return first;

    const corrected = GeneratedResponseSchema.parse(
      JSON.parse(await this.complete(system + retries.join(''), user, this.generationModel)),
    );
    if (context.confirmationRequest && !isValidConfirmationResponse(corrected)) {
      throw new Error(
        'Confirmation response requires a question-free confirmationSummary copied verbatim into text and exactly one question in the full reply',
      );
    }
    return corrected;
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
    temperature = 0.3,
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
        temperature,
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
