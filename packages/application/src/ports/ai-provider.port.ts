import type {
  SituationClassification,
  RiskDetection,
  MemoryProposal,
  ReplyStrategy,
  GeneratedResponse,
  SurveyEvidenceEvaluation,
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
}
