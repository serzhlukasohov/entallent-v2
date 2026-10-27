import {
  ConversationOrchestrator,
  systemClock,
  type ClockPort,
  type AiProviderPort,
  type ClassifyContext,
  type ConversationRecord,
  type ConversationTurn,
  type EscalationEvent,
  type EscalationPort,
  type MemoryContext,
  type MemoryItemRecord,
  type MessageRecord,
  type OnboardingTurnPort,
  type OrchestrateResult,
  type ResponseContext,
  type RiskContext,
  type ScheduledActionRepositoryPort,
  type SurveyRepositoryPort,
  type SurveyQuestionForEvaluation,
  type QuestionBundleComposition,
  type QuestionBundleVariant,
  type AwaitingQuestionBundle,
  type QuestionBundleVerdict,
  type PendingQuestionClarification,
  type QuestionClarificationVerdict,
  type QuestionConfirmationPort,
  type PulseBacklogService,
  type StyleProfileRecord,
} from '@entalent/application';
import type {
  ConfirmationResponse,
  GeneratedResponse,
  GroupReport,
  GroupSummary,
  MemoryProposal,
  ObservedStyle,
  ReplyStrategy,
  ProviderRiskDetection,
  SituationClassification,
  SurveyEvidenceEvaluation,
} from '@entalent/contracts';
import {
  InMemoryConversationRepository,
  InMemoryGoalRepository,
  InMemoryMemoryRepository,
  InMemoryStyleProfileRepository,
} from '../fakes/repositories';
import { InlineOutbox } from '../fakes/inline-outbox';
import { registerFallbackReport } from './report';

export const SIM_TENANT_ID = 'sim-tenant';
export const SIM_USER_ID = 'sim-user';
export const SIM_CONVERSATION_ID = 'sim-conversation';
const TENANT_ID = SIM_TENANT_ID;
const USER_ID = SIM_USER_ID;
const CONVERSATION_ID = SIM_CONVERSATION_ID;

/** The single conversation every harness talks in; injected repositories are built around it. */
export function createSimConversation(options: {
  userName?: string;
  timezone?: string;
  clock?: ClockPort;
} = {}): ConversationRecord {
  return {
    id: CONVERSATION_ID,
    tenantId: TENANT_ID,
    userId: USER_ID,
    channelType: 'sim',
    externalConversationId: 'sim-channel',
    status: 'active',
    userDisplayName: options.userName ?? 'Alex',
    userTimezone: options.timezone ?? 'Europe/Berlin',
    userTimezoneUpdatedAt: (options.clock ?? systemClock).now(),
  };
}

export interface CoachHarnessOptions {
  userName?: string;
  /** IANA timezone; seeded so the harness never triggers profile hydration. */
  timezone?: string;
  /** Runs style analysis between turns at the cost of one LLM call per turn. */
  analyzeStyle?: boolean;
  /** Memory items the user is assumed to have accumulated before this conversation. */
  seedMemory?: Array<Pick<MemoryItemRecord, 'category' | 'content' | 'importance'>>;
  /** Style profile learned in a previous conversation. */
  seedStyleProfile?: StyleProfileRecord;
  /**
   * Required: the harness never builds a provider itself. Live call sites pass
   * `createLiveProvider()` from `./live-provider`; offline ones a scripted provider.
   */
  aiProvider: AiProviderPort;
  /**
   * Injected ports (for example recording proxies). Each defaults to the in-memory
   * implementation the harness builds itself. An injected `conversationRepo` must hold
   * `createSimConversation(...)`, and `userName` / `timezone` are then ignored; an
   * injected `styleRepo` ignores `seedStyleProfile`. An injected `outbox` is used as is,
   * so `analyzeStyle` only applies to the default outbox.
   */
  conversationRepo?: InMemoryConversationRepository;
  memoryRepo?: InMemoryMemoryRepository;
  goalRepo?: InMemoryGoalRepository;
  styleRepo?: InMemoryStyleProfileRepository;
  outbox?: InlineOutbox;
  /**
   * Not built by the harness: when `clock` is set, construct it with the same clock
   * (e.g. `new InMemoryScheduledActionRepository(clock)`) or its stamps use the system clock.
   */
  scheduledActionRepo?: ScheduledActionRepositoryPort;
  surveyRepo?: SurveyRepositoryPort;
  onboardingTurn?: OnboardingTurnPort;
  /** V2 question-confirmation state (ready bundles, clarifications); omitted means no V2 turns. */
  questionConfirmationRepo?: QuestionConfirmationPort;
  /** Topic selection for the pulse cycle (GC round 3 CAP-1); omitted means no topic questions. */
  pulseBacklogService?: Pick<PulseBacklogService, 'getNextProbeQuestion'>;
  /** Business time for the orchestrator, in-memory repositories and outbox; defaults to the system clock. */
  clock?: ClockPort;
  /** Writes a scenario report when the enclosing Vitest test fails; defaults to true. */
  fallbackReport?: boolean;
}

/** One delivered user message and what the orchestrator returned for it. */
export interface HarnessTurn {
  result: OrchestrateResult;
  /** The traceId the turn ran under; outbound messages of this turn carry it. */
  traceId: string;
  inboundMessageId: string;
}

export interface GenerateResponseCall {
  turns: ConversationTurn[];
  strategy: ReplyStrategy;
  context: ResponseContext;
}

/** An exception that escaped `ConversationOrchestrator.orchestrate` during one `send`. */
export interface AgentTurnFailure {
  /** 1-based position the turn would have had in `turns`; nothing is pushed there for it. */
  turn: number;
  name: string;
  message: string;
  stack: string | null;
  /** Generation attempts made for this turn before the throw (see `generateResponseCalls`). */
  generationCalls: number;
}

class RecordingEscalation implements EscalationPort {
  readonly events: EscalationEvent[] = [];

  async raise(event: EscalationEvent): Promise<void> {
    this.events.push(event);
  }
}

/**
 * Wires the production `ConversationOrchestrator` to in-memory adapters and a live
 * AI provider. Everything between the inbound message and the outbound text is real
 * code: classification, risk detection, strategy selection, prompt construction and
 * generation. Only storage and transport are substituted.
 */
export class CoachHarness {
  readonly conversationRepo: InMemoryConversationRepository;
  readonly clock: ClockPort;
  readonly memoryRepo: InMemoryMemoryRepository;
  readonly goalRepo: InMemoryGoalRepository;
  readonly styleRepo: InMemoryStyleProfileRepository;
  readonly escalation = new RecordingEscalation();
  readonly outbox: InlineOutbox;
  readonly turns: OrchestrateResult[] = [];
  /** All calls, including regeneration attempts; this is not indexed by conversation turn. */
  readonly generateResponseCalls: GenerateResponseCall[] = [];
  /** Final generation call for each completed send; null when the response bypassed generation. */
  readonly responseCallsByTurn: Array<GenerateResponseCall | null> = [];
  /**
   * Errors thrown by the orchestrator, in order. `send` records and rethrows, so the scenario
   * still fails while the report keeps the error class instead of losing it with the stack trace.
   */
  readonly failures: AgentTurnFailure[] = [];

  private readonly orchestrator: ConversationOrchestrator;
  /** Delivery attempts, including ones whose orchestration threw. */
  private attempts = 0;

  constructor(options: CoachHarnessOptions) {
    this.clock = options.clock ?? systemClock;
    this.memoryRepo = options.memoryRepo ?? new InMemoryMemoryRepository(this.clock);
    this.goalRepo = options.goalRepo ?? new InMemoryGoalRepository(this.clock);
    this.conversationRepo = options.conversationRepo ?? new InMemoryConversationRepository(
      createSimConversation({ userName: options.userName, timezone: options.timezone, clock: this.clock }),
      this.clock,
    );
    this.styleRepo = options.styleRepo ?? new InMemoryStyleProfileRepository(options.seedStyleProfile ?? null);

    const ai = new RecordingAiProvider(options.aiProvider, this.generateResponseCalls);
    this.outbox = options.outbox ?? new InlineOutbox(
      ai,
      this.conversationRepo,
      this.memoryRepo,
      this.goalRepo,
      this.styleRepo,
      { analyzeStyle: options.analyzeStyle, clock: this.clock },
    );

    for (const item of options.seedMemory ?? []) {
      void this.memoryRepo.save({
        tenantId: TENANT_ID,
        userId: USER_ID,
        category: item.category,
        content: item.content,
        confidence: 0.9,
        importance: item.importance,
        sensitivity: 'normal',
        sourceMessageIds: [],
      });
    }

    this.orchestrator = new ConversationOrchestrator(
      this.conversationRepo,
      ai,
      this.outbox,
      this.memoryRepo,
      options.surveyRepo ?? {
        findPulseCaptureForConversation: async () => [],
        findAwaitingConfirmationGroups: async () => [],
        findPendingConfirmationGroups: async () => [],
      } as unknown as SurveyRepositoryPort,
      undefined,
      this.escalation,
      undefined,
      options.scheduledActionRepo,
      options.pulseBacklogService as PulseBacklogService | undefined,
      this.styleRepo,
      this.goalRepo,
      options.questionConfirmationRepo,
      undefined,
      options.onboardingTurn,
      undefined,
      this.clock,
    );

    // A report must exist even when the scenario aborts before `reportRun` is reached.
    if (options.fallbackReport !== false) registerFallbackReport(this);
  }

  /** Delivers one user message and returns the coach's reply. */
  async send(text: string): Promise<string> {
    const { result } = await this.sendTurn(text);
    return result.responseText;
  }

  /** Delivers one user message and returns the orchestrator result with the turn's ids. */
  async sendTurn(text: string): Promise<HarnessTurn> {
    const generationStart = this.generateResponseCalls.length;
    const inbound = await this.conversationRepo.saveMessage({
      conversationId: CONVERSATION_ID,
      tenantId: TENANT_ID,
      userId: USER_ID,
      direction: 'inbound',
      text,
    });

    // `turn` keeps the `turns` position for failure reports; the trace number counts every
    // attempt, so a turn after a throwing one never reuses a traceId under a fixed clock.
    const turn = this.turns.length + 1;
    const traceId = `sim-turn-${++this.attempts}-${this.clock.now().getTime()}`;
    let result: OrchestrateResult;
    try {
      result = await this.orchestrator.orchestrate({
        messageId: inbound.id,
        conversationId: CONVERSATION_ID,
        userId: USER_ID,
        tenantId: TENANT_ID,
        externalWorkspaceId: 'sim-workspace',
        externalConversationId: 'sim-channel',
        traceId,
      });
    } catch (error) {
      this.failures.push(describeFailure(error, turn, this.generateResponseCalls.length - generationStart));
      throw error;
    }

    this.responseCallsByTurn.push(
      this.generateResponseCalls.length > generationStart
        ? this.generateResponseCalls[this.generateResponseCalls.length - 1]!
        : null,
    );
    this.turns.push(result);
    return { result, traceId, inboundMessageId: inbound.id };
  }

  get replies(): string[] {
    return this.turns.map((t) => t.responseText);
  }

  get transcript(): MessageRecord[] {
    return this.conversationRepo.messages;
  }

  get memoryItems(): MemoryItemRecord[] {
    return this.memoryRepo.items.filter((i) => i.status === 'active');
  }

  styleProfile(): Promise<StyleProfileRecord | null> {
    return this.styleRepo.findByUser(USER_ID, TENANT_ID);
  }
}

/** Exported for tests; scenarios reach it only through `CoachHarness`. */
export class RecordingAiProvider implements AiProviderPort {
  constructor(
    private readonly delegate: AiProviderPort,
    private readonly generateCalls: GenerateResponseCall[],
  ) {}

  classifySituation(
    turns: ConversationTurn[],
    context: ClassifyContext,
  ): Promise<SituationClassification> {
    return this.delegate.classifySituation(turns, context);
  }

  detectRisk(turns: ConversationTurn[], context: RiskContext): Promise<ProviderRiskDetection> {
    return this.delegate.detectRisk(turns, context);
  }

  extractMemory(turns: ConversationTurn[], existing: MemoryContext): Promise<MemoryProposal> {
    return this.delegate.extractMemory(turns, existing);
  }

  evaluateSurveyEvidence(
    turns: ConversationTurn[],
    questions: SurveyQuestionForEvaluation[],
    options?: Parameters<AiProviderPort['evaluateSurveyEvidence']>[2],
  ): Promise<SurveyEvidenceEvaluation> {
    return this.delegate.evaluateSurveyEvidence(turns, questions, options);
  }

  async generateResponse(
    turns: ConversationTurn[],
    strategy: ReplyStrategy,
    context: ResponseContext,
  ): Promise<GeneratedResponse> {
    this.generateCalls.push({ turns, strategy, context });
    return this.delegate.generateResponse(turns, strategy, context);
  }

  composeQuestionBundle(
    turns: ConversationTurn[],
    questions: Array<{ surveyQuestionId: string; workingSummary: string }>,
    responseLanguage: string,
    variant?: QuestionBundleVariant,
  ): Promise<QuestionBundleComposition> {
    return this.delegate.composeQuestionBundle(turns, questions, responseLanguage, variant);
  }

  interpretQuestionBundleResponse(
    turns: ConversationTurn[],
    bundle: Pick<AwaitingQuestionBundle, 'displayedText' | 'components'>,
  ): Promise<QuestionBundleVerdict> {
    return this.delegate.interpretQuestionBundleResponse(turns, bundle);
  }

  composeQuestionClarification(
    turns: ConversationTurn[],
    clarification: Pick<PendingQuestionClarification, 'workingSummary' | 'disputedStatement'>,
    responseLanguage: string,
  ): Promise<string> {
    return this.delegate.composeQuestionClarification(turns, clarification, responseLanguage);
  }

  interpretQuestionClarificationResponse(
    turns: ConversationTurn[],
    clarification: Pick<PendingQuestionClarification, 'workingSummary' | 'disputedStatement'>,
  ): Promise<QuestionClarificationVerdict> {
    return this.delegate.interpretQuestionClarificationResponse(turns, clarification);
  }

  generateGroupSummary(
    summaries: Array<{ questionId: string; stableKey: string; evidenceSummary: string; polarity: string }>,
    questionGroup: string,
  ): Promise<GroupSummary> {
    return this.delegate.generateGroupSummary(summaries, questionGroup);
  }

  generateGroupReport(
    teamSummaries: string[],
    questionGroup: string,
    teamScore: number,
    trend: number | null,
  ): Promise<GroupReport> {
    return this.delegate.generateGroupReport(teamSummaries, questionGroup, teamScore, trend);
  }

  scoreSentiment(text: string): Promise<number> {
    return this.delegate.scoreSentiment(text);
  }

  interpretConfirmationResponse(
    turns: ConversationTurn[],
    summary: string,
  ): Promise<ConfirmationResponse> {
    return this.delegate.interpretConfirmationResponse(turns, summary);
  }

  analyzeStyle(userTurns: string[]): Promise<ObservedStyle> {
    return this.delegate.analyzeStyle(userTurns);
  }
}

function describeFailure(error: unknown, turn: number, generationCalls: number): AgentTurnFailure {
  if (error instanceof Error) {
    return { turn, name: error.name, message: error.message, stack: error.stack ?? null, generationCalls };
  }
  return { turn, name: typeof error, message: String(error), stack: null, generationCalls };
}
