import {
  ConversationOrchestrator,
  type AiProviderPort,
  type ClassifyContext,
  type ConversationRecord,
  type ConversationTurn,
  type EscalationEvent,
  type EscalationPort,
  type MemoryContext,
  type MemoryItemRecord,
  type MessageRecord,
  type OrchestrateResult,
  type ResponseContext,
  type RiskContext,
  type ScheduledActionRepositoryPort,
  type SurveyRepositoryPort,
  type SurveyQuestionForEvaluation,
  type QuestionBundleComposition,
  type AwaitingQuestionBundle,
  type QuestionBundleVerdict,
  type PendingQuestionClarification,
  type QuestionClarificationVerdict,
  type QuestionConfirmationPort,
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
import { OpenAiProvider } from '@entalent/ai-openai';
import {
  InMemoryConversationRepository,
  InMemoryGoalRepository,
  InMemoryMemoryRepository,
  InMemoryStyleProfileRepository,
} from '../fakes/repositories';
import { InlineOutbox } from '../fakes/inline-outbox';
import { registerFallbackReport } from './report';

const TENANT_ID = 'sim-tenant';
const USER_ID = 'sim-user';
const CONVERSATION_ID = 'sim-conversation';

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
  aiProvider?: AiProviderPort;
  scheduledActionRepo?: ScheduledActionRepositoryPort;
  surveyRepo?: SurveyRepositoryPort;
  /** V2 question-confirmation state (ready bundles, clarifications); omitted means no V2 turns. */
  questionConfirmationRepo?: QuestionConfirmationPort;
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
  readonly memoryRepo = new InMemoryMemoryRepository();
  readonly goalRepo = new InMemoryGoalRepository();
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

  constructor(options: CoachHarnessOptions = {}) {
    const conversation: ConversationRecord = {
      id: CONVERSATION_ID,
      tenantId: TENANT_ID,
      userId: USER_ID,
      channelType: 'sim',
      externalConversationId: 'sim-channel',
      status: 'active',
      userDisplayName: options.userName ?? 'Alex',
      userTimezone: options.timezone ?? 'Europe/Berlin',
      userTimezoneUpdatedAt: new Date(),
    };

    this.conversationRepo = new InMemoryConversationRepository(conversation);
    this.styleRepo = new InMemoryStyleProfileRepository(options.seedStyleProfile ?? null);

    const ai = new RecordingAiProvider(
      options.aiProvider ?? createLiveProvider(),
      this.generateResponseCalls,
    );
    this.outbox = new InlineOutbox(
      ai,
      this.conversationRepo,
      this.memoryRepo,
      this.goalRepo,
      this.styleRepo,
      { analyzeStyle: options.analyzeStyle },
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
      undefined,
      this.styleRepo,
      this.goalRepo,
      options.questionConfirmationRepo,
    );

    // A report must exist even when the scenario aborts before `reportRun` is reached.
    registerFallbackReport(this);
  }

  /** Delivers one user message and returns the coach's reply. */
  async send(text: string): Promise<string> {
    const generationStart = this.generateResponseCalls.length;
    const inbound = await this.conversationRepo.saveMessage({
      conversationId: CONVERSATION_ID,
      tenantId: TENANT_ID,
      userId: USER_ID,
      direction: 'inbound',
      text,
    });

    const turn = this.turns.length + 1;
    let result: OrchestrateResult;
    try {
      result = await this.orchestrator.orchestrate({
        messageId: inbound.id,
        conversationId: CONVERSATION_ID,
        userId: USER_ID,
        tenantId: TENANT_ID,
        externalWorkspaceId: 'sim-workspace',
        externalConversationId: 'sim-channel',
        traceId: `sim-turn-${turn}`,
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
    return result.responseText;
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

class RecordingAiProvider implements AiProviderPort {
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
  ): Promise<QuestionBundleComposition> {
    return this.delegate.composeQuestionBundle(turns, questions, responseLanguage);
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

/** Mirrors `AiService` in the worker so simulations exercise the shipped provider setup. */
function createLiveProvider(): AiProviderPort {
  const azureEndpoint = process.env.AZURE_OPENAI_ENDPOINT;
  if (azureEndpoint) {
    return new OpenAiProvider({
      azure: true,
      endpoint: azureEndpoint,
      apiKey: requireEnv('AZURE_OPENAI_API_KEY'),
      apiVersion: requireEnv('AZURE_OPENAI_API_VERSION'),
      deploymentName: process.env.OPENAI_MODEL_BALANCED ?? 'gpt-4o',
    });
  }

  return new OpenAiProvider({
    apiKey: requireEnv('OPENAI_API_KEY'),
    organizationId: process.env.OPENAI_ORG_ID || undefined,
  });
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required to run conversation simulations.`);
  return value;
}
