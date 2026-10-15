import type {
  SituationClassification,
  ProviderRiskDetection,
  MemoryProposal,
  ReplyStrategy,
  GeneratedResponse,
  SurveyEvidenceEvaluation,
  GroupSummary,
  GroupReport,
  ConfirmationResponse,
  ObservedStyle,
} from '@entalent/contracts';
import type { SurveyResponseType, PulseCaptureRecord } from '../types/records';
import type {
  AwaitingQuestionBundle,
  PendingQuestionClarification,
  QuestionBundleVerdict,
  QuestionClarificationVerdict,
} from './question-confirmation.port';

export type QuestionBundleVariant = 'confirmation' | 'corrected_statement';

export interface ConversationTurn {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

export interface ClassifyContext {
  userName: string;
  tenantContext?: string;
  /** Persisted user-derived thread summary; untrusted and optional classifier context. */
  continuitySummary?: string;
  /** Current time as ISO 8601 — lets the classifier compute reminder dueAt values */
  now?: string;
  /** IANA timezone of the employee — reminder times are interpreted in it */
  timezone?: string;
}

export interface RiskContext {
  userName: string;
}

export interface MemoryContext {
  items: Array<{ id: string; category: string; content: string; importance: number }>;
  goals: Array<{ id: string; title: string; status: string }>;
}

export interface SurveyQuestionForEvaluation {
  id: string;
  stableKey: string;
  canonicalMeaning: string;
  positiveIndicators: string[];
  negativeIndicators: string[];
  contraindications: string[];
  responseType?: SurveyResponseType;
}

export interface SurveyEvidenceEvaluationOptions {
  focusLatestEmployeeMessage?: boolean;
}

export interface QuestionBundleComposition {
  text: string;
  statements: Array<{ surveyQuestionId: string; statement: string }>;
}

export interface ReplyPlan {
  dialogueAct: import('@entalent/contracts').DialogueAct;
  /** A correction occurred in the last two mentor replies; do not revive its rejected frame. */
  correctionCarryover?: boolean;
  latestUserSubstance: string | null;
  topicAnchor: string | null;
  /** Explicit employee-stated facts that must not be reopened as clarifications. */
  resolvedDetails?: string[];
  memoryAnchors: Array<{ category: string; content: string }>;
  responseMove:
    | 'social_greeting'
    | 'social_reply'
    | 'address_new_substance'
    | 'continue_existing_thread'
    | 'answer_request'
    | 'support_emotion'
    | 'close_or_pause';
  mayInferFromBrevity: boolean;
  questionPolicy: {
    maxQuestions: 0 | 1;
    reason:
      | 'strategy_disallows_questions'
      | 'greeting_no_question'
      | 'greeting_opens_conversation'
      | 'social_checkin_returns_question'
      | 'acknowledgement_no_new_substance'
      | 'asked_recently'
      | 'new_substance_allows_question';
  };
  requiredGrounding: Array<{
    source: 'memory';
    category: string;
    content: string;
    requirement: 'mention_explicitly';
  }>;
  forbiddenMoves: Array<'comment_on_brevity' | 'diagnose' | 'survey_probe' | 'operational_status' | 'action_plan' | 'unsupported_interpretation'>;
}

/** @deprecated Use ReplyPlan. Kept as a compatibility alias while prompts/tests migrate. */
export type ReplyBrief = ReplyPlan;

export interface LanguagePolicy {
  /** Primary BCP-47 language subtag the mentor replies in. */
  responseLanguage: string;
  source: 'product_default';
}

/**
 * Grounded facts for a pulse-capture transparency question (GC round 3 CAP-5). The model
 * answers in its own words from these; deterministic code never writes the reply.
 */
export interface PulseCaptureFacts {
  /** What the employee asked about: the whole conversation, one exact message, or unresolved. */
  scope: 'conversation' | 'exact' | 'unresolved';
  /** Persisted captures in scope; empty when nothing is persisted or the scope is unresolved. */
  captures: Array<Pick<PulseCaptureRecord, 'evidenceSummary' | 'status'>>;
}

export interface ResponseContext {
  userName: string;
  /** Set only on a pulse-capture transparency turn; the reply must stay within these facts. */
  captureFacts?: PulseCaptureFacts;
  tenantContext?: string;
  languagePolicy: LanguagePolicy;
  memoryContext?: MemoryContext;
  /** Canonical policy text for answering employee questions about reporting. */
  reportingDisclosure?: string;
  /** For proactive follow-ups: the original reason + message strategy hint for the LLM */
  followUpIntent?: string;
  /**
   * Set on the immediate reply after the employee asked for a reminder — the agent
   * should naturally acknowledge that it will remind them.
   */
  reminderConfirmation?: { intent: string; dueAt: string };
  /**
   * Set when a user-requested reminder actually fires — the agent should deliver
   * the reminder the employee asked for.
   */
  reminderIntent?: string;
  /** Survey probe to embed naturally in the response */
  surveyProbeQuestion?: { id: string; probeStrategies: string[]; responseType?: SurveyResponseType };
  /** Agent-initiated check-in: the agent writes first, optionally steering toward a survey topic */
  proactiveCheckIn?: {
    probeQuestion?: { id: string; probeStrategies: string[]; responseType?: SurveyResponseType };
  };
  /**
   * Set when the employee just confirmed a summary the agent proposed.
   * Signals that this topic is now closed — acknowledge and move on, no more probing.
   */
  topicConfirmed?: {
    questionGroup: string;
    /** Progress after this confirmation (GC round 3 CAP-3); the reply states it plainly. */
    topicsClosed?: number;
    topicsTotal?: number;
  };
  /**
   * Set when the employee asked what is left in the pulse cycle (GC round 3 CAP-3). The reply is
   * grounded on these counts and topic names only; evidence text never travels here.
   */
  cycleProgress?: {
    inCycle: boolean;
    topicsTotal: number;
    topicsClosed: number;
    openTopics: string[];
    awaitingReply: boolean;
  };
  /**
   * Set when a question group has completed and the agent should reflect its
   * understanding back and ask for confirmation IN THIS REPLY (confirm-only, no
   * other question, no probe).
   */
  confirmationRequest?: {
    questionGroup: string;
    evidence: Array<{ stableKey: string; evidenceSummary: string; polarity: string; sourceMessageIds?: string[] }>;
  };
  /**
   * OBSERVED user style (EMA, per-axis 0..1) + adaptation weight (0..0.4) + a few of
   * the user's phrases. The renderer decides which axes to nudge (u vs base) and how
   * strongly (scaled by weight), keeping the base persona dominant; omitted in crisis.
   */
  styleAdaptation?: { dimensions: import('../types/records').StyleDimensions; weight: number; phrases: string[] };
  /**
   * Employee's current local time, human-readable (e.g. "Saturday, 15:30 (afternoon)").
   * Lets the reply use a natural time-appropriate greeting/sign-off when it fits.
   */
  localTime?: string;
  /** True on the first message of a session (long gap) — greetings/sign-offs fit here. */
  isSessionStart?: boolean;
  /**
   * Structured dialogue-state for the next reply. This is generated before prose
   * generation so style mirroring affects wording only, not semantic inference from
   * terse surface form.
   */
  replyBrief?: ReplyBrief;
  /** Typed response policy: what the generator must do, before it decides wording. */
  replyPlan?: ReplyPlan;
  /**
   * V2 confirmation bundle or clarification question composed for this turn (GC round 3 CAP-4).
   * The reply answers the employee's latest message first; this text is shown last, byte-for-byte.
   */
  trailingBundle?: TrailingBundle;
}

export interface TrailingBundle {
  kind: 'confirmation_bundle' | 'clarification' | 'corrected_statement';
  /** Validated composition text; the only question of the turn lives here. */
  text: string;
  /** Bundle statements the reply part must not restate (confirmation bundles only). */
  statements?: readonly string[];
}

export interface AiProviderPort {
  classifySituation(
    turns: ConversationTurn[],
    context: ClassifyContext,
  ): Promise<SituationClassification>;

  /** Model risk output plus any provider moderation signal; may throw ModerationSignalError. */
  detectRisk(turns: ConversationTurn[], context: RiskContext): Promise<ProviderRiskDetection>;

  extractMemory(turns: ConversationTurn[], existing: MemoryContext): Promise<MemoryProposal>;

  evaluateSurveyEvidence(
    turns: ConversationTurn[],
    questions: SurveyQuestionForEvaluation[],
    options?: SurveyEvidenceEvaluationOptions,
  ): Promise<SurveyEvidenceEvaluation>;

  generateResponse(
    turns: ConversationTurn[],
    strategy: ReplyStrategy,
    context: ResponseContext,
  ): Promise<GeneratedResponse>;

  composeQuestionBundle(
    turns: ConversationTurn[],
    questions: Array<{ surveyQuestionId: string; workingSummary: string }>,
    responseLanguage: string,
    /** 'corrected_statement' reflects one meaning the employee just corrected (GC round 3 CAP-3). */
    variant?: QuestionBundleVariant,
  ): Promise<QuestionBundleComposition>;

  interpretQuestionBundleResponse(
    turns: ConversationTurn[],
    bundle: Pick<AwaitingQuestionBundle, 'displayedText' | 'components'>,
  ): Promise<QuestionBundleVerdict>;

  composeQuestionClarification(
    turns: ConversationTurn[],
    clarification: Pick<PendingQuestionClarification, 'workingSummary' | 'disputedStatement'>,
    responseLanguage: string,
  ): Promise<string>;

  interpretQuestionClarificationResponse(
    turns: ConversationTurn[],
    clarification: Pick<PendingQuestionClarification, 'workingSummary' | 'disputedStatement'>,
  ): Promise<QuestionClarificationVerdict>;

  generateGroupSummary(
    summaries: Array<{ questionId: string; stableKey: string; evidenceSummary: string; polarity: string }>,
    questionGroup: string,
  ): Promise<GroupSummary>;

  generateGroupReport(
    teamSummaries: string[],
    questionGroup: string,
    teamScore: number,
    trend: number | null,
  ): Promise<GroupReport>;

  scoreSentiment(text: string): Promise<number>;

  interpretConfirmationResponse(
    turns: ConversationTurn[],
    summary: string,
  ): Promise<ConfirmationResponse>;

  analyzeStyle(userTurns: string[]): Promise<ObservedStyle>;
}
