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
import { isExplicitPulseCaptureRequest } from '@entalent/application';
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

function stripExposedConfirmationSummaryLabel(response: GeneratedResponse): GeneratedResponse {
  return response.confirmationSummary
    ? { ...response, text: response.text.replace(/\bconfirmationSummary\s*:\s*/i, '') }
    : response;
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
    return normalizeExplicitClosing(
      normalizeExplicitCorrectionRequest(
        normalizePulseCaptureExplanation(
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
    const user = buildRespondUserPrompt(turns, context, strategy);

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
        retries.push(lengthRetryInstruction(maxReplyChars(strategy, context)));
      }
      const maxQuestions = maxAllowedQuestions(strategy, context);
      if (countQuestionGroups(first.text) > maxQuestions) {
        retries.push(questionRetryInstruction(maxQuestions));
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
    if (!context.confirmationRequest && countQuestionGroups(corrected.text) > maxAllowedQuestions(strategy, context)) {
      throw new Error('Generated response exceeds the question limit after one corrective attempt');
    }
    if (numericProbe && !isValidNumericProbeResponse(corrected, numericProbe.id)) {
      throw new Error('OpenAI returned a noncompliant numeric survey probe after retry');
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
  /\b(?:help\s+me|remind\s+me|(?:draft|write|create|set|schedule|add|update|delete|send)\s+(?:me\s+)?(?:a|an|the|this|that|my)\b|помоги|напомни|создай|отправь|допоможи|нагадай|створи|надішли)\b/iu;
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
    || (/[“”«»"]/u.test(latestEmployeeText)
      && /(?:pulse|пульс).{0,40}(?:information|data|информац|дан)/iu.test(latestEmployeeText));
  const explicitRequest = isExplicitPulseCaptureRequest(latestEmployeeText);
  const safetyRequest = safetyIntent !== undefined
    && PULSE_CAPTURE_QUESTION_FRAGMENT.test(latestEmployeeText);
  const typedRequest = classification.primaryIntent === 'pulse_capture_explanation'
    && classification.dialogueAct === 'request';
  const mixedActionRequest = MIXED_ACTION_REQUEST.test(latestEmployeeText) && !explicitRequest;
  if (
    !isControlRequest
    && !mixedActionRequest
    && (explicitRequest || safetyRequest || typedRequest)
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
      reminderRequest: null,
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
  return {
    ...classification,
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
