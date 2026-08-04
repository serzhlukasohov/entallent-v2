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

export interface ConversationTurn {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

export interface ClassifyContext {
  userName: string;
  tenantContext?: string;
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
}

export interface ReplyPlan {
  dialogueAct: import('@entalent/contracts').DialogueAct;
  latestUserSubstance: string | null;
  topicAnchor: string | null;
  memoryAnchors: Array<{ category: string; content: string }>;
  responseMove: 'address_new_substance' | 'continue_existing_thread' | 'answer_request' | 'support_emotion' | 'close_or_pause';
  mayInferFromBrevity: boolean;
  questionPolicy: {
    maxQuestions: 0 | 1;
    reason:
      | 'strategy_disallows_questions'
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
  forbiddenMoves: Array<'comment_on_brevity' | 'diagnose' | 'survey_probe' | 'action_plan'>;
}

/** @deprecated Use ReplyPlan. Kept as a compatibility alias while prompts/tests migrate. */
export type ReplyBrief = ReplyPlan;

export interface ResponseContext {
  userName: string;
  tenantContext?: string;
  memoryContext?: MemoryContext;
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
  surveyProbeQuestion?: { id: string; probeStrategies: string[] };
  /** Agent-initiated check-in: the agent writes first, optionally steering toward a survey topic */
  proactiveCheckIn?: {
    probeQuestion?: { id: string; probeStrategies: string[] };
  };
  /**
   * Set when the employee just confirmed a summary the agent proposed.
   * Signals that this topic is now closed — acknowledge and move on, no more probing.
   */
  topicConfirmed?: { questionGroup: string };
  /**
   * Set when a question group has completed and the agent should reflect its
   * understanding back and ask for confirmation IN THIS REPLY (confirm-only, no
   * other question, no probe).
   */
  confirmationRequest?: {
    questionGroup: string;
    evidence: Array<{ stableKey: string; evidenceSummary: string; polarity: string }>;
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
}

export interface AiProviderPort {
  classifySituation(
    turns: ConversationTurn[],
    context: ClassifyContext,
  ): Promise<SituationClassification>;

  detectRisk(turns: ConversationTurn[], context: RiskContext): Promise<RiskDetection>;

  extractMemory(turns: ConversationTurn[], existing: MemoryContext): Promise<MemoryProposal>;

  evaluateSurveyEvidence(
    turns: ConversationTurn[],
    questions: SurveyQuestionForEvaluation[],
  ): Promise<SurveyEvidenceEvaluation>;

  generateResponse(
    turns: ConversationTurn[],
    strategy: ReplyStrategy,
    context: ResponseContext,
  ): Promise<GeneratedResponse>;

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
