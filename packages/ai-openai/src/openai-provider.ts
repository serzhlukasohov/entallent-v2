import OpenAI, { AzureOpenAI } from 'openai';
import { CircuitBreaker } from './circuit-breaker';
import { ProviderContentFilterError } from '@entalent/application';
import {
  SituationClassificationSchema,
  SituationIntentSchema,
  DialogueActSchema,
  RiskDetectionSchema,
  ModerationSignalError,
  MemoryItemProposalSchema,
  GoalProposalSchema,
  FollowUpCandidateSchema,
  GeneratedResponseSchema,
  SurveyEvidenceEvaluationSchema,
  QuestionScoreResponseSchema,
  QuestionDeidentifiedSummarySchema,
  GroupSummarySchema,
  GroupReportSchema,
  SentimentScoreSchema,
  ConfirmationResponseSchema,
  ObservedStyleSchema,
  type SituationClassification,
  type ProviderRiskDetection,
  type ModerationCategory,
  type ModerationSignal,
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
  SurveyEvidenceEvaluationOptions,
  QuestionBundleComposition,
  AwaitingQuestionBundle,
  QuestionBundleVerdict,
  PendingQuestionClarification,
  QuestionClarificationVerdict,
  ApprovedQuestionRubric,
  QuestionScoreResult,
} from '@entalent/application';
import {
  BundleCompositionInvalidError,
  BundleReplyInvalidError,
  composeBundleReplyText,
  isBundleCompositionInvalidError,
  maxReplyChars,
  validateBundleReply,
  validateQuestionBundleComposition,
  validateQuestionBundleVerdict,
  validateQuestionClarificationPrompt,
  validateQuestionClarificationVerdict,
  type TrailingBundle,
} from '@entalent/application';
import { buildClassifySystemPrompt, buildClassifyUserPrompt } from './prompts/classify';
import { buildStyleAnalyzeSystemPrompt, buildStyleAnalyzeUserPrompt } from './prompts/style-analyze';
import { buildMemorySystemPrompt, buildMemoryUserPrompt } from './prompts/memory';
import { buildRiskSystemPrompt, buildRiskUserPrompt } from './prompts/risk';
import { buildRespondSystemPrompt, buildRespondUserPrompt } from './prompts/respond';
import { buildSurveySystemPrompt, buildSurveyUserPrompt } from './prompts/survey';
import { buildGroupConfirmationSystemPrompt, buildGroupConfirmationUserPrompt } from './prompts/group-confirmation';
import {
  buildQuestionBundleRepairInstruction, buildQuestionBundleSystemPrompt, buildQuestionBundleUserPrompt,
} from './prompts/question-bundle';
import { buildQuestionBundleInterpretSystemPrompt, buildQuestionBundleInterpretUserPrompt } from './prompts/question-bundle-interpret';
import {
  buildQuestionClarificationSystemPrompt,
  buildQuestionClarificationUserPrompt,
  buildQuestionClarificationInterpretSystemPrompt,
  buildQuestionClarificationInterpretUserPrompt,
} from './prompts/question-clarification';
import { buildConfirmInterpretSystemPrompt, buildConfirmInterpretUserPrompt } from './prompts/confirm-interpret';
import { buildGroupReportSystemPrompt, buildGroupReportUserPrompt } from './prompts/group-report';
import {
  QUESTION_SCORE_PROMPT_VERSION,
  buildQuestionScoreSystemPrompt,
  buildQuestionScoreUserPrompt,
  buildQuestionDeidentifySystemPrompt,
  buildQuestionDeidentifyUserPrompt,
} from './prompts/question-insight-finalization';

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

function errorFields(error: unknown): Record<string, unknown> {
  return typeof error === 'object' && error !== null ? error as Record<string, unknown> : {};
}

function isConfirmedAzureInputFilter(error: unknown): boolean {
  const outer = errorFields(error);
  const body = errorFields(outer['error']);
  const code = outer['code'] ?? body['code'];
  const param = outer['param'] ?? body['param'];
  const inner = errorFields(outer['innererror'] ?? body['innererror']);
  return outer['status'] === 400 && code === 'content_filter'
    && (param === 'prompt' || inner['code'] === 'ResponsibleAIPolicyViolation');
}

function isRetryableProviderFailure(error: unknown): boolean {
  if (error instanceof ProviderContentFilterError) return false;
  const status = errorFields(error)['status'];
  return typeof status !== 'number' || status === 429 || status >= 500;
}

function questionRetryInstruction(maxQuestions: 0 | 1): string {
  return maxQuestions === 0
    ? '\n\nYour previous draft asked a question. This turn must ask none — rewrite without any question anywhere in the reply.'
    : '\n\nYour previous draft asked more than one question. Rewrite with at most one question in the entire reply.';
}

const BUNDLE_REPLY_RETRY_INSTRUCTION =
  '\n\nYour previous draft broke the two-part contract. Return "replyText" as 1-3 sentences that answer the employee\'s latest message with no question mark or other question punctuation, within the length limit, and without repeating the fixed text or any of its statements; return "bundleText" as a byte-for-byte copy of the fixed text given above, with nothing added, removed, or changed.';

const CONFIRMATION_RETRY_INSTRUCTION =
  '\n\nYour previous confirmation draft was invalid. Return a non-empty reportable "confirmationSummary" with no question punctuation, copy that exact byte-for-byte string into "text" as a proper substring (never the entire reply), do not expose field labels like "confirmationSummary:", and ask exactly one question in the full "text" outside that summary.';

function exposesConfirmationSummaryLabel(text: string): boolean {
  return /\bconfirmationSummary\s*:/i.test(text);
}

function stripExposedConfirmationSummaryLabel(response: GeneratedResponse): GeneratedResponse {
  return response.confirmationSummary
    ? { ...response, text: response.text.replace(/\bconfirmationSummary\s*:\s*/i, '') }
    : response;
}

/** A draft that fails to parse is a contract break like any other: repair once, then fail closed. */
function assembleBundleReply(
  raw: string,
  bundleText: string,
  options: { maxReplyChars: number; statements?: readonly string[] },
): GeneratedResponse | BundleReplyInvalidError {
  let response: GeneratedResponse;
  try {
    response = GeneratedResponseSchema.parse(JSON.parse(raw));
  } catch {
    return new BundleReplyInvalidError('draft_unparseable');
  }
  try {
    const parts = validateBundleReply(response, bundleText, options);
    return {
      ...response, ...parts, text: composeBundleReplyText(parts), containsSurveyProbe: false, surveyProbeQuestionId: undefined,
    };
  } catch (error) {
    return error instanceof BundleReplyInvalidError ? error : new BundleReplyInvalidError('reply_missing');
  }
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
function lengthRetryInstruction(maxChars: number, context?: Pick<ResponseContext, 'replyPlan' | 'replyBrief'>): string {
  const words = Math.max(8, Math.round(maxChars / 6));
  const replyPlan = context?.replyPlan ?? context?.replyBrief;
  if (replyPlan?.formatRequest) {
    return `\n\nYour previous draft was too long for this turn. Rewrite it within ${words} words: keep the list shape the employee asked for (one item per line), trim each item to its essentials, and drop any prose around the items.`;
  }
  return `\n\nYour previous draft was too long for this turn. Rewrite it much shorter — at most ${words} words, one sentence if you can. Keep only the single most useful thing and drop the extra observation.`;
}

function countQuestionGroups(text: string): number {
  return text.match(/[?;՞؟፧᥅⁇⁈⁉⸮﹖？❓❔]+/gu)?.length ?? 0;
}

const SOFT_QUESTION_RETRY_INSTRUCTION =
  '\n\nYour previous draft asked a question or ended with an offer of your own. This turn delivers the item and stops: remove any question, offer, or "do you want" of your own. Quoted phrases or items the employee could say may keep their own question marks.';

/**
 * Question limit the deterministic gate enforces. On a delivery turn (an accepted offer or a
 * requested list) the gate is soft: it drives ONE repair of a trailing question or offer but never
 * fails the turn, because delivered phrases and items legitimately quote question marks the mentor
 * is not asking (ADR-013 D2: a lexical count validates structure, it does not override the typed
 * contract that allows them).
 */
function questionGateFor(strategy: ReplyStrategy, context: ResponseContext): { maxQuestions: 0 | 1; soft: boolean } {
  const replyPlan = context.replyPlan ?? context.replyBrief;
  if (replyPlan) {
    const reason = replyPlan.questionPolicy.reason;
    return {
      maxQuestions: replyPlan.questionPolicy.maxQuestions,
      soft: reason === 'offer_delivery' || reason === 'format_request',
    };
  }
  return { maxQuestions: strategy.includeFollowUpQuestion || context.proactiveCheckIn ? 1 : 0, soft: false };
}

function numericProbeQuestion(context: ResponseContext): { id: string } | undefined {
  const probe = context.surveyProbeQuestion ?? context.proactiveCheckIn?.probeQuestion;
  return probe?.responseType === 'numeric_0_10' ? probe : undefined;
}

function isValidNumericProbeResponse(response: GeneratedResponse, questionId: string): boolean {
  const includesScale = /(?:\b0\b[\s\S]*\b10\b|\b10\b[\s\S]*\b0\b)/u.test(response.text);
  return response.containsSurveyProbe === true &&
    response.surveyProbeQuestionId === questionId &&
    countQuestionGroups(response.text) === 1 &&
    includesScale;
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

/** A draft that is not JSON is a composition failure the model can repair, not a parser crash. */
function parseCompositionDraft(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch (error) {
    if (error instanceof SyntaxError) throw new BundleCompositionInvalidError('draft_unparseable');
    throw error;
  }
}

export class OpenAiProvider implements AiProviderPort {
  private readonly client: OpenAI;
  private readonly analysisModel: string;
  private readonly generationModel: string;
  private readonly breaker = new CircuitBreaker({
    failureThreshold: 5, windowMs: 60_000, cooldownMs: 30_000,
    // A content-filter or other permanent 400 is a property of the request, not provider health:
    // one user's message must not open the breaker for every other conversation.
    isFailure: isRetryableProviderFailure,
  });
  private readonly azure: boolean;

  constructor(config: OpenAiProviderConfig) {
    this.azure = config.azure === true;
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
    return normalizeExplicitClosing(
      normalizePulseCaptureExplanation(
        normalizeExplicitCorrectionRequest(
          normalizeDataUseExplanation(
            normalizeReportingExplanation(SituationClassificationSchema.parse(parsed), turns),
            turns,
          ),
          turns,
        ),
        turns,
      ),
      turns,
    );
  }

  /**
   * Risk detection at temperature 0 (ADR-013 R1) with the provider's moderation signal attached
   * as a tripwire: Azure content-filter annotations on the same call, or the OpenAI moderation
   * endpoint in parallel. A refusal or failure that carries a moderation signal is rethrown as
   * ModerationSignalError so policy can still raise severity.
   */
  async detectRisk(turns: ConversationTurn[], context: RiskContext): Promise<ProviderRiskDetection> {
    const latestUserText = [...turns].reverse().find((turn) => turn.role === 'user')?.content ?? '';
    const [completion, endpointModeration] = await Promise.allSettled([
      this.completeWithResponse(
        buildRiskSystemPrompt(),
        buildRiskUserPrompt(turns, context),
        this.analysisModel,
        2048,
        0,
      ),
      this.azure ? Promise.resolve(undefined) : this.moderate(latestUserText),
    ]);
    const openAiSignal = endpointModeration.status === 'fulfilled' ? endpointModeration.value : undefined;

    if (completion.status === 'rejected') {
      const blocked = azureContentFilterSignal(completion.reason);
      const signal = blocked ?? openAiSignal;
      if (signal) throw new ModerationSignalError(signal, 'Risk detection failed with a moderation signal');
      throw completion.reason;
    }

    const detection = RiskDetectionSchema.parse(JSON.parse(completion.value.content));
    const signal = this.azure ? azurePromptAnnotationSignal(completion.value.response) : openAiSignal;
    return signal ? { ...detection, moderation: signal } : detection;
  }

  /** OpenAI moderation endpoint (free). Best-effort: a failure yields no signal, never an error. */
  private async moderate(text: string): Promise<ModerationSignal | undefined> {
    if (!text.trim()) return undefined;
    try {
      const response = await this.client.moderations.create({ model: 'omni-moderation-latest', input: text });
      return openAiModerationSignal(response.results?.[0]?.categories as unknown as Record<string, boolean> | undefined);
    } catch {
      return undefined;
    }
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
    options?: SurveyEvidenceEvaluationOptions,
  ): Promise<SurveyEvidenceEvaluation> {
    const raw = await this.complete(
      buildSurveySystemPrompt(options),
      buildSurveyUserPrompt(turns, questions),
      this.analysisModel,
      4096,
    );
    return SurveyEvidenceEvaluationSchema.parse(JSON.parse(raw));
  }

  async scoreConfirmedMeaning(input: {
    semanticSummary: string;
    rubric: ApprovedQuestionRubric;
    questionId: string;
    scoringPolicyVersion: string;
  }): Promise<QuestionScoreResult> {
    const raw = await this.complete(
      buildQuestionScoreSystemPrompt(),
      buildQuestionScoreUserPrompt(input),
      this.analysisModel,
      512,
      0,
    );
    const result = QuestionScoreResponseSchema.parse(JSON.parse(raw));
    return {
      ...result,
      modelId: this.analysisModel,
      promptVersion: QUESTION_SCORE_PROMPT_VERSION,
    };
  }

  async deidentify(input: { semanticSummary: string; attempt: number }): Promise<string> {
    const raw = await this.complete(
      buildQuestionDeidentifySystemPrompt(input.attempt),
      buildQuestionDeidentifyUserPrompt(input.semanticSummary),
      this.analysisModel,
      512,
      0,
    );
    return QuestionDeidentifiedSummarySchema.parse(JSON.parse(raw)).summary;
  }

  async generateResponse(
    turns: ConversationTurn[],
    strategy: ReplyStrategy,
    context: ResponseContext,
  ): Promise<GeneratedResponse> {
    const system = buildRespondSystemPrompt(strategy, context);
    const user = buildRespondUserPrompt(turns, context, strategy);
    if (context.trailingBundle) {
      return this.generateBundleReply(system, user, strategy, context, context.trailingBundle);
    }

    const first = stripExposedConfirmationSummaryLabel(GeneratedResponseSchema.parse(
      JSON.parse(await this.complete(system, user, this.generationModel)),
    ));

    // Deterministic invariants the persona won't respect from a soft prompt hint. Collect
    // what fired, do ONE corrective regeneration, then fail closed on an invalid confirmation.
    const retries: string[] = [];
    if (context.confirmationRequest) {
      if (!isValidConfirmationResponse(first)) retries.push(CONFIRMATION_RETRY_INSTRUCTION);
    } else {
      if (first.text.length > maxReplyChars(strategy, context)) {
        retries.push(lengthRetryInstruction(maxReplyChars(strategy, context), context));
      }
      const questionGate = questionGateFor(strategy, context);
      if (countQuestionGroups(first.text) > questionGate.maxQuestions) {
        retries.push(questionGate.soft ? SOFT_QUESTION_RETRY_INSTRUCTION : questionRetryInstruction(questionGate.maxQuestions));
      }
    }
    const numericProbe = numericProbeQuestion(context);
    if (numericProbe && !isValidNumericProbeResponse(first, numericProbe.id)) {
      retries.push(
        '\n\nYour previous draft did not ask the selected numeric probe correctly. Rewrite it as exactly one question that explicitly asks for a rating from 0 to 10, and set the matching survey-probe metadata.',
      );
    }
    if (retries.length === 0) return first;

    const corrected = stripExposedConfirmationSummaryLabel(GeneratedResponseSchema.parse(
      JSON.parse(await this.complete(system + retries.join(''), user, this.generationModel)),
    ));
    if (context.confirmationRequest && !isValidConfirmationResponse(corrected)) {
      throw new Error(
        'Confirmation response requires a question-free confirmationSummary copied verbatim into text and exactly one question in the full reply',
      );
    }
    const correctedGate = questionGateFor(strategy, context);
    if (!context.confirmationRequest && !correctedGate.soft
      && countQuestionGroups(corrected.text) > correctedGate.maxQuestions) {
      throw new Error('Generated response exceeds the question limit after one corrective attempt');
    }
    if (numericProbe && !isValidNumericProbeResponse(corrected, numericProbe.id)) {
      throw new Error('OpenAI returned a noncompliant numeric survey probe after retry');
    }
    return corrected;
  }

  /**
   * GC round 3 CAP-4: one structured generation with the answer and a byte-for-byte copy of the
   * fixed text. The generic length and question gates do not apply to the assembled message; the
   * reply part is validated on its own, with ONE repair, then fails closed so the orchestrator
   * can send the fixed text alone.
   */
  private async generateBundleReply(
    system: string,
    user: string,
    strategy: ReplyStrategy,
    context: ResponseContext,
    bundle: TrailingBundle,
  ): Promise<GeneratedResponse> {
    const options = { maxReplyChars: maxReplyChars(strategy, context), statements: bundle.statements };
    const first = assembleBundleReply(await this.complete(system, user, this.generationModel), bundle.text, options);
    if (!(first instanceof BundleReplyInvalidError)) return first;
    const corrected = assembleBundleReply(
      await this.complete(system + BUNDLE_REPLY_RETRY_INSTRUCTION, user, this.generationModel), bundle.text, options,
    );
    if (!(corrected instanceof BundleReplyInvalidError)) return corrected;
    throw corrected;
  }

  async composeQuestionBundle(
    turns: ConversationTurn[],
    questions: Array<{ surveyQuestionId: string; workingSummary: string }>,
    responseLanguage: string,
  ): Promise<QuestionBundleComposition> {
    const system = buildQuestionBundleSystemPrompt(responseLanguage, questions.length);
    const user = buildQuestionBundleUserPrompt(turns, questions);
    const questionIds = questions.map((question) => question.surveyQuestionId);
    try {
      return validateQuestionBundleComposition(
        parseCompositionDraft(await this.complete(system, user, this.generationModel, 2048)),
        questionIds,
      );
    } catch (error) {
      if (!isBundleCompositionInvalidError(error)) throw error;
      // ONE corrective recomposition naming the broken rule, then fail closed with the reason
      // of the second draft so the turn can degrade diagnosably.
      const repaired = await this.complete(
        system + buildQuestionBundleRepairInstruction(error.reason),
        user,
        this.generationModel,
        2048,
      );
      return validateQuestionBundleComposition(parseCompositionDraft(repaired), questionIds);
    }
  }

  async interpretQuestionBundleResponse(
    turns: ConversationTurn[],
    bundle: Pick<AwaitingQuestionBundle, 'displayedText' | 'components'>,
  ): Promise<QuestionBundleVerdict> {
    const raw = await this.complete(
      buildQuestionBundleInterpretSystemPrompt(bundle.components.length),
      buildQuestionBundleInterpretUserPrompt(turns, bundle),
      this.analysisModel,
      512,
    );
    return validateQuestionBundleVerdict(
      JSON.parse(raw) as unknown,
      bundle.components.map((component) => component.surveyQuestionId),
    );
  }

  async composeQuestionClarification(
    turns: ConversationTurn[],
    clarification: Pick<PendingQuestionClarification, 'workingSummary' | 'disputedStatement'>,
    responseLanguage: string,
  ): Promise<string> {
    const raw = await this.complete(
      buildQuestionClarificationSystemPrompt(responseLanguage),
      buildQuestionClarificationUserPrompt(turns, clarification),
      this.generationModel,
      512,
    );
    const parsed: unknown = JSON.parse(raw);
    const text = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)['text']
      : undefined;
    return validateQuestionClarificationPrompt(text);
  }

  async interpretQuestionClarificationResponse(
    turns: ConversationTurn[],
    clarification: Pick<PendingQuestionClarification, 'workingSummary' | 'disputedStatement'>,
  ): Promise<QuestionClarificationVerdict> {
    const raw = await this.complete(
      buildQuestionClarificationInterpretSystemPrompt(),
      buildQuestionClarificationInterpretUserPrompt(turns, clarification),
      this.analysisModel,
      512,
    );
    return validateQuestionClarificationVerdict(JSON.parse(raw) as unknown);
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
    const { content } = await this.completeWithResponse(systemPrompt, userPrompt, model, maxTokens, temperature);
    return content;
  }

  private async completeWithResponse(
    systemPrompt: string,
    userPrompt: string,
    model: string,
    maxTokens: number,
    temperature: number,
  ): Promise<{ content: string; response: unknown }> {
    return this.breaker.call(async () => {
      let response;
      try {
        response = await this.client.chat.completions.create({
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
      } catch (error) {
        if (this.azure && isConfirmedAzureInputFilter(error)) {
          throw new ProviderContentFilterError(
            'input',
            azureContentFilterSignal(error)?.categories ?? [],
            azureFilteredCategoryKeys(error),
          );
        }
        throw error;
      }

      const choice = response.choices[0];
      if (this.azure && choice?.finish_reason === 'content_filter') {
        throw new ProviderContentFilterError('output');
      }
      const content = choice?.message?.content;
      if (!content) throw new Error('OpenAI returned an empty response');
      // A truncated response is invalid JSON — surface it clearly instead of
      // letting JSON.parse throw a cryptic SyntaxError the caller can't diagnose.
      if (choice?.finish_reason === 'length') {
        throw new Error(
          `OpenAI response truncated (finish_reason=length, max_completion_tokens=${maxTokens}) — raise the token budget for this call`,
        );
      }
      return { content, response };
    });
  }
}

type AzureFilterResult = Record<string, { filtered?: boolean; severity?: string } | undefined>;

const AZURE_FILTER_CATEGORIES: Array<[string, ModerationCategory]> = [
  ['self_harm', 'self_harm'],
  ['violence', 'violence'],
];

function azureFilterCategories(result: AzureFilterResult | undefined): ModerationSignal['categories'] {
  if (!result) return [];
  const categories: ModerationSignal['categories'] = [];
  for (const [key, category] of AZURE_FILTER_CATEGORIES) {
    const level = result[key]?.severity;
    if (level === 'low' || level === 'medium' || level === 'high') categories.push({ category, level });
  }
  return categories;
}

const AZURE_FILTER_KEY = /^[a-z_]{1,32}$/;
const AZURE_FILTER_KEY_LIMIT = 8;

/**
 * The provider category keys whose result says the prompt was filtered or a shield detected it.
 * Keys are format-validated and capped so the value stays a bounded diagnostic (ADR-013 D2).
 */
function azureFilteredCategoryKeys(error: unknown): string[] {
  const outer = errorFields(error);
  const body = errorFields(outer['error']);
  const inner = errorFields(outer['innererror'] ?? body['innererror']);
  const result = inner['content_filter_result'];
  if (typeof result !== 'object' || result === null) return [];
  return Object.entries(result as Record<string, unknown>)
    .filter(([key, value]) => AZURE_FILTER_KEY.test(key)
      && typeof value === 'object' && value !== null
      && ((value as { filtered?: unknown }).filtered === true || (value as { detected?: unknown }).detected === true))
    .map(([key]) => key)
    .sort()
    .slice(0, AZURE_FILTER_KEY_LIMIT);
}

function isAzureContentFilterError(err: unknown): boolean {
  return typeof err === 'object' && err !== null
    && (err as { status?: unknown }).status === 400
    && (err as { code?: unknown }).code === 'content_filter';
}

/** Azure rejects a prompt that crosses its content-filter threshold with a 400 content_filter. */
function azureContentFilterSignal(err: unknown): ModerationSignal | undefined {
  if (err instanceof ProviderContentFilterError) {
    return err.direction === 'input'
      ? { source: 'azure_content_filter', blocked: true, categories: [...err.categories] }
      : undefined;
  }
  if (!isAzureContentFilterError(err)) return undefined;
  const inner = (err as { error?: { innererror?: { content_filter_result?: AzureFilterResult } } })
    .error?.innererror?.content_filter_result;
  return { source: 'azure_content_filter', blocked: true, categories: azureFilterCategories(inner) };
}

/** Prompt annotations on a successful Azure call. They cover the whole risk prompt window. */
function azurePromptAnnotationSignal(response: unknown): ModerationSignal | undefined {
  const results = (response as { prompt_filter_results?: Array<{ content_filter_results?: AzureFilterResult }> })
    ?.prompt_filter_results;
  if (!Array.isArray(results)) return undefined;
  const categories = results.flatMap((entry) => azureFilterCategories(entry.content_filter_results));
  return categories.length > 0 ? { source: 'azure_content_filter', blocked: false, categories } : undefined;
}

const OPENAI_MODERATION_CATEGORIES: Array<[string, ModerationCategory]> = [
  ['self-harm', 'self_harm'],
  ['self-harm/intent', 'self_harm_intent'],
  ['self-harm/instructions', 'self_harm_instructions'],
  ['violence', 'violence'],
  ['harassment/threatening', 'harassment_threatening'],
  ['hate/threatening', 'hate_threatening'],
];

function openAiModerationSignal(flags: Record<string, boolean> | undefined): ModerationSignal | undefined {
  if (!flags) return undefined;
  const categories = OPENAI_MODERATION_CATEGORIES
    .filter(([key]) => flags[key] === true)
    .map(([, category]) => ({ category, level: null }));
  return categories.length > 0 ? { source: 'openai_moderation', blocked: false, categories } : undefined;
}

const EXPLICIT_CORRECTION_REQUEST_PREFIX =
  /^(?:no\b(?!\s+(?:idea|problem|worries)\b)|that(?:'s| is) not what\b|this is not what\b|you (?:keep|are still|still)\b|i (?:didn['’]?t|did not|don['’]?t|do not) mean\b|нет\b|ні\b|это не то\b|це не те\b)/i;
const EXPLICIT_CLOSING =
  /^(?:(?:no|нет|ні)[,\s-]*(?:forget(?: it)?|never ?mind|drop it|leave it(?: there)?|забудь|неважно|досить|достаточно)|forget(?: it)?|never ?mind|drop it|leave it(?: there)?|забудь(?: про це|об этом)?|неважно|досить|достаточно)[.!]?$/i;
const EXPLICIT_REPORTING_EXPLANATION_REQUEST =
  /(?:\b(?:where|who).{0,80}\b(?:confirm(?:ed)?|pulse|information|data|report)|\b(?:confirm(?:ed)?|pulse|information|data|report).{0,80}\b(?:go|used|shared?|reported?|sees?)\b|\bhow .{0,80}\b(?:used?|shared?|reported?)\b|(?:куда|кто).{0,80}(?:подтвержд|информац|данн|отч[её]т)|(?:подтвержд|информац|данн|отч[её]т).{0,80}(?:пойд|использ|увид|доступ)|(?:куди|хто).{0,80}(?:підтвердж|інформац|дан|звіт)|(?:підтвердж|інформац|дан|звіт).{0,80}(?:піде|використ|побач|доступ))/i;
const EXPLICIT_INDIVIDUAL_REPORTING_ACCESS_REQUEST =
  /\b(?:manager(?:'s)?|hr)\b.{0,120}\b(?:access|open|read|see)\b.{0,120}\b(?:messages?|answers?|personal summar(?:y|ies)|tasks?|goals?|identity)\b/i;
const EXPLICIT_UNCONFIRMED_REPORTING_REQUEST =
  /^(?:and\s+)?if i (?:do not|don['’]?t) confirm it,?\s*can my answers still be used in team reports\??$/i;
const SAFETY_UNCONFIRMED_REPORTING_REQUEST =
  /(?:^|[.!?]\s+)(?:and\s+)?if i (?:do not|don['’]?t) confirm it,?\s*can my answers still be used in team reports\??$/i;
const EXPLICIT_TEXT_TRANSFORM_REQUEST =
  /^(?:(?:could|can|would)\s+you\s+(?:please\s+)?|please\s+)?(?:translate|rewrite|paraphrase|proofread|explain\s+(?:why\s+)?(?:this|the)\s+(?:sentence|wording))\b|^(?:пожалуйста[,\s]+|будь\s+ласка[,\s]+)?(?:переведи|переведите|переклади|перекладіть|перепиши|перефразируй|перефразуй|проверь|перевір)\b/iu;
const EXPLICIT_CHATBOT_EVALUATION_REQUEST =
  /^(?:(?:could|can|would)\s+you\s+(?:please\s+)?|please\s+)?(?:evaluate|review|critique|analy[sz]e)(?:\s+this\s+(?:response|reply)\s+from)?\s+(?:(?:another|the|this)\s+)?(?:chatbot|bot|assistant)(?:'s)?\b/i;
const EXPLICIT_DATA_USE_REQUEST =
  /^(?:what|how)\s+do\s+you\s+use\s+(?:my\s+messages?|what\s+i\s+(?:say|send)|my\s+(?:data|information))(?:\s+for)?\s*\?(?:\s*are\s+you\s+(?:a\s+)?(?:real\s+person|human)\s*\?)?\s*$/i;
const EXPLICIT_TEAM_REPORT_DATA_USE_REQUEST =
  /^how\s+do\s+you\s+use\s+(?:my\s+messages?|what\s+i\s+(?:say|send)|my\s+(?:data|information))\s+(?:in|for)\s+(?:team\s+)?reports?\s*\?\s*$/i;
const EXPLICIT_LOCALIZED_DATA_USE_REQUEST =
  /^(?:(?:для чего|как)\s+ты\s+используешь\s+мои\s+сообщения\s*\?(?:\s*ты\s+настоящий\s+человек\s*\?)?|(?:для чого|як)\s+ти\s+використовуєш\s+мої\s+повідомлення\s*\?(?:\s*ти\s+справжня\s+людина\s*\?)?)\s*$/iu;
const EXPLICIT_DATA_USE_FOLLOW_UP =
  /^do\s+you\s+(?:also\s+)?use\s+(?:my\s+messages?|what\s+i\s+(?:say|send)|my\s+(?:data|information))\s+for\b.{0,120}\b(?:memory|goals?|tasks?|reminders?|pulse|reporting|safety)\b[^.!?]*\?\s*$/i;
const DATA_USE_QUESTION_FRAGMENT =
  /(?:what|how)\s+do\s+you\s+use\s+(?:my\s+messages?|what\s+i\s+(?:say|send)|my\s+(?:data|information))|do\s+you\s+(?:also\s+)?use\s+(?:my\s+messages?|what\s+i\s+(?:say|send))\s+for\b|(?:для чего|как)\s+ты\s+используешь\s+мои\s+сообщения|(?:для чого|як)\s+ти\s+використовуєш\s+мої\s+повідомлення/iu;
const MIXED_ACTION_REQUEST =
  /(?:\b(?:help\s+me|remind\s+me|(?:draft|write|create|set|schedule|add|update|delete|send)\s+(?:me\s+)?(?:a|an|the|this|that|my))\b|(?:^|[\s,;])(?:помоги|напомни|создай|отправь|допоможи|нагадай|створи|надішли)(?=$|[\s,;.!?]))/iu;
const EXPLICIT_REMINDER_REQUEST =
  /\b(?:remind|ping)\s+me\b|\bdon['’]?t\s+let\s+me\s+forget\b|(?:^|[\s,;])(?:напомни(?:\s+мне)?|не\s+дай\s+мне\s+забыть|нагадай(?:\s+мені)?|не\s+дай\s+мені\s+забути)(?=$|[\s,;.!?])/iu;
const HELP_UNDERSTAND_PREFIX = /^(?:(?:could|can|would)\s+you\s+)?(?:please\s+)?help\s+me\s+understand\b|^(?:пожалуйста[,\s]+)?помоги\s+мне\s+понять(?=$|[\s,;.!?])|^(?:будь\s+ласка[,\s]+)?допоможи\s+мені\s+зрозуміти(?=$|[\s,;.!?])/iu;
const PULSE_CAPTURE_QUESTION_FRAGMENT =
  /what\s+exact\s+(?:pulse\s+)?information.{0,40}(?:pick(?:ed)?(?:\s+up)?|captur(?:e|ed)|record(?:ed)?|sav(?:e|ed)).{0,30}(?:discussion|conversation|chat)|(?:какую|что)\s+именно.{0,40}(?:пульс|информац|данн).{0,50}(?:сохранил|зафиксировал|извл[её]к)|(?:яку|що)\s+саме.{0,40}(?:пульс|інформац|дан).{0,50}(?:зберіг|зафіксував|витяг)/iu;

function normalizePulseCaptureExplanation(
  classification: SituationClassification,
  turns: ConversationTurn[],
): SituationClassification {
  const hasIntent = classification.primaryIntent === 'pulse_capture_explanation'
    || classification.secondaryIntents.includes('pulse_capture_explanation');
  const latestEmployeeText = [...turns]
    .reverse()
    .find((turn) => turn.role === 'user')
    ?.content.trim() ?? '';
  const safetyIntent = [classification.primaryIntent, ...classification.secondaryIntents]
    .find((intent) => intent === 'burnout_signal'
      || intent === 'harassment_signal'
      || intent === 'potential_crisis');
  const isControlRequest = EXPLICIT_TEXT_TRANSFORM_REQUEST.test(latestEmployeeText)
    || EXPLICIT_CHATBOT_EVALUATION_REQUEST.test(latestEmployeeText)
    || /^the\s+employee\s+(?:wrote|said|asked)\b/iu.test(latestEmployeeText);
  const safetyRequest = safetyIntent !== undefined
    && PULSE_CAPTURE_QUESTION_FRAGMENT.test(latestEmployeeText);
  const explicitReminderRequest = EXPLICIT_REMINDER_REQUEST.test(latestEmployeeText);
  const typedReminderRequest = hasIntent
    && classification.pulseCaptureScope !== undefined
    && classification.reminderRequest !== null
    && explicitReminderRequest;
  const typedRequest = hasIntent
    && classification.pulseCaptureScope !== undefined
    && (
      ['request', 'correction', 'continuation'].includes(classification.dialogueAct)
      || explicitReminderRequest
    );
  const helpUnderstandRemainder = latestEmployeeText.replace(HELP_UNDERSTAND_PREFIX, '');
  const mixedActionRequest = MIXED_ACTION_REQUEST.test(
    helpUnderstandRemainder === latestEmployeeText ? latestEmployeeText : helpUnderstandRemainder,
  );
  const additionalActionRequest = helpUnderstandRemainder
    .split(/[,.!?;\n]+|\b(?:and|also|plus|then|afterwards|и|та|і|затем|потом|тоді)\b/iu)
    .some((part) => MIXED_ACTION_REQUEST.test(part) && !EXPLICIT_REMINDER_REQUEST.test(part));
  if (
    !isControlRequest
    && (!mixedActionRequest || (typedReminderRequest && !additionalActionRequest))
    && (safetyRequest || typedRequest)
  ) {
    if (safetyIntent) {
      return {
        ...classification,
        surveyAllowed: false,
        primaryIntent: safetyIntent,
        secondaryIntents: [
          ...classification.secondaryIntents.filter(
            (intent) => intent !== safetyIntent && intent !== 'pulse_capture_explanation',
          ),
          'pulse_capture_explanation',
        ],
      };
    }
    return {
      ...classification,
      surveyAllowed: false,
      reminderRequest: typedReminderRequest ? classification.reminderRequest : null,
      primaryIntent: 'pulse_capture_explanation',
      secondaryIntents: classification.secondaryIntents.filter(
        (intent) => intent !== 'pulse_capture_explanation'
          && intent !== 'reporting_explanation'
          && intent !== 'data_use_explanation',
      ),
    };
  }
  if (!hasIntent) return classification;
  const fallbackPrimary = safetyIntent
    ?? (classification.secondaryIntents.includes('reporting_explanation')
      ? 'reporting_explanation'
      : classification.secondaryIntents.includes('data_use_explanation')
        ? 'data_use_explanation'
        : classification.primaryIntent === 'pulse_capture_explanation'
          ? classification.dialogueAct === 'request' ? 'clarification' : 'casual_conversation'
          : classification.primaryIntent);
  return {
    ...classification,
    pulseCaptureScope: classification.pulseCaptureScope?.type === 'previous_exact'
      ? { type: 'unresolved' }
      : classification.pulseCaptureScope,
    primaryIntent: fallbackPrimary,
    secondaryIntents: classification.secondaryIntents.filter(
      (intent) => intent !== 'pulse_capture_explanation' && intent !== fallbackPrimary,
    ),
  };
}

function normalizeDataUseExplanation(
  classification: SituationClassification,
  turns: ConversationTurn[],
): SituationClassification {
  const hasDataUseIntent = classification.primaryIntent === 'data_use_explanation'
    || classification.secondaryIntents.includes('data_use_explanation');
  const latestEmployeeText = [...turns]
    .reverse()
    .find((turn) => turn.role === 'user')
    ?.content.trim() ?? '';
  const safetyIntent = [classification.primaryIntent, ...classification.secondaryIntents]
    .find((intent) => intent === 'burnout_signal'
      || intent === 'harassment_signal'
      || intent === 'potential_crisis');
  const isControlRequest = EXPLICIT_TEXT_TRANSFORM_REQUEST.test(latestEmployeeText)
    || EXPLICIT_CHATBOT_EVALUATION_REQUEST.test(latestEmployeeText)
    || (/[“”«»"]/u.test(latestEmployeeText)
      && DATA_USE_QUESTION_FRAGMENT.test(latestEmployeeText));
  const explicitDataUseRequest = EXPLICIT_DATA_USE_REQUEST.test(latestEmployeeText)
    || EXPLICIT_LOCALIZED_DATA_USE_REQUEST.test(latestEmployeeText)
    || EXPLICIT_DATA_USE_FOLLOW_UP.test(latestEmployeeText);
  const mixedActionRequest = MIXED_ACTION_REQUEST.test(latestEmployeeText);
  const safetyDataUseRequest = safetyIntent !== undefined
    && DATA_USE_QUESTION_FRAGMENT.test(latestEmployeeText);
  const typedDataUseRequest = classification.primaryIntent === 'data_use_explanation'
    && classification.dialogueAct === 'request';
  if (!safetyIntent && EXPLICIT_TEAM_REPORT_DATA_USE_REQUEST.test(latestEmployeeText)) {
    return {
      ...classification,
      primaryIntent: 'reporting_explanation',
      secondaryIntents: classification.secondaryIntents.filter(
        (intent) => intent !== 'data_use_explanation' && intent !== 'reporting_explanation',
      ),
    };
  }
  if (
    !isControlRequest
    && !mixedActionRequest
    && classification.primaryIntent !== 'reporting_explanation'
    && (explicitDataUseRequest || safetyDataUseRequest || typedDataUseRequest)
  ) {
    if (safetyIntent) {
      return {
        ...classification,
        surveyAllowed: false,
        primaryIntent: safetyIntent,
        secondaryIntents: [
          ...classification.secondaryIntents.filter(
            (intent) => intent !== safetyIntent && intent !== 'data_use_explanation',
          ),
          'data_use_explanation',
        ],
      };
    }
    return {
      ...classification,
      surveyAllowed: false,
      reminderRequest: null,
      primaryIntent: 'data_use_explanation',
      secondaryIntents: classification.secondaryIntents.filter(
        (intent) => intent !== 'data_use_explanation',
      ),
    };
  }
  if (!hasDataUseIntent) return classification;
  const fallbackPrimary = safetyIntent
    ?? (classification.secondaryIntents.includes('reporting_explanation')
      ? 'reporting_explanation'
      : classification.primaryIntent === 'data_use_explanation'
        ? classification.dialogueAct === 'request' ? 'clarification' : 'casual_conversation'
        : classification.primaryIntent);
  return {
    ...classification,
    primaryIntent: fallbackPrimary,
    secondaryIntents: classification.secondaryIntents.filter(
      (intent) => intent !== 'data_use_explanation' && intent !== fallbackPrimary,
    ),
  };
}

function normalizeReportingExplanation(
  classification: SituationClassification,
  turns: ConversationTurn[],
): SituationClassification {
  const hasReportingIntent = classification.primaryIntent === 'reporting_explanation'
    || classification.secondaryIntents.includes('reporting_explanation');
  const latestEmployeeText = [...turns]
    .reverse()
    .find((turn) => turn.role === 'user')
    ?.content.trim() ?? '';
  const safetyIntent = [classification.primaryIntent, ...classification.secondaryIntents]
    .find((intent) => intent === 'burnout_signal'
      || intent === 'harassment_signal'
      || intent === 'potential_crisis');
  const textTransformRequest = !safetyIntent
    && EXPLICIT_TEXT_TRANSFORM_REQUEST.test(latestEmployeeText);
  const unconfirmedReportingRequest = EXPLICIT_UNCONFIRMED_REPORTING_REQUEST.test(latestEmployeeText)
    || (safetyIntent !== undefined
      && SAFETY_UNCONFIRMED_REPORTING_REQUEST.test(latestEmployeeText));
  if (
    !textTransformRequest
    && (unconfirmedReportingRequest
      || (EXPLICIT_INDIVIDUAL_REPORTING_ACCESS_REQUEST.test(latestEmployeeText)
        && (classification.dialogueAct === 'request' || safetyIntent)))
  ) {
    if (safetyIntent) {
      return {
        ...classification,
        surveyAllowed: unconfirmedReportingRequest ? false : classification.surveyAllowed,
        primaryIntent: safetyIntent,
        secondaryIntents: [
          ...classification.secondaryIntents.filter(
            (intent) => intent !== safetyIntent && intent !== 'reporting_explanation',
          ),
          'reporting_explanation',
        ],
      };
    }
    return {
      ...classification,
      surveyAllowed: unconfirmedReportingRequest ? false : classification.surveyAllowed,
      primaryIntent: 'reporting_explanation',
      secondaryIntents: classification.secondaryIntents.filter(
        (intent) => intent !== 'reporting_explanation',
      ),
    };
  }
  if (!hasReportingIntent) return classification;
  if (
    !textTransformRequest
    &&
    EXPLICIT_REPORTING_EXPLANATION_REQUEST.test(latestEmployeeText)
    && (classification.dialogueAct === 'request' || safetyIntent)
  ) return classification;
  return {
    ...classification,
    primaryIntent: classification.primaryIntent === 'reporting_explanation'
      ? classification.dialogueAct === 'request' ? 'clarification' : 'casual_conversation'
      : classification.primaryIntent,
    secondaryIntents: classification.secondaryIntents.filter((intent) => intent !== 'reporting_explanation'),
  };
}

function normalizeExplicitClosing(
  classification: SituationClassification,
  turns: ConversationTurn[],
): SituationClassification {
  const latestEmployeeText = [...turns]
    .reverse()
    .find((turn) => turn.role === 'user')
    ?.content.trim();
  if (!latestEmployeeText || !EXPLICIT_CLOSING.test(latestEmployeeText)) {
    return classification;
  }
  const hasPulseCaptureIntent = classification.primaryIntent === 'pulse_capture_explanation'
    || classification.secondaryIntents.includes('pulse_capture_explanation');
  return {
    ...classification,
    primaryIntent: classification.primaryIntent === 'pulse_capture_explanation'
      ? 'casual_conversation'
      : classification.primaryIntent,
    secondaryIntents: classification.secondaryIntents.filter(
      (intent) => intent !== 'pulse_capture_explanation',
    ),
    pulseCaptureScope: hasPulseCaptureIntent
      ? { type: 'unresolved' }
      : classification.pulseCaptureScope,
    dialogueAct: 'closing',
    latestUserSubstance: null,
    topicAnchor: null,
  };
}

function normalizeExplicitCorrectionRequest(
  classification: SituationClassification,
  turns: ConversationTurn[],
): SituationClassification {
  if (classification.dialogueAct !== 'request' && classification.dialogueAct !== 'closing') return classification;
  const latestEmployeeText = [...turns]
    .reverse()
    .find((turn) => turn.role === 'user')
    ?.content.trim();
  if (!latestEmployeeText || !EXPLICIT_CORRECTION_REQUEST_PREFIX.test(latestEmployeeText)) {
    return classification;
  }
  return { ...classification, dialogueAct: 'correction' };
}
