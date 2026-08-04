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
  type SurveyQuestionForEvaluation,
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
  RiskDetection,
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
}

export interface GenerateResponseCall {
  turns: ConversationTurn[];
  strategy: ReplyStrategy;
  context: ResponseContext;
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
  readonly generateResponseCalls: GenerateResponseCall[] = [];

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
      undefined,
      undefined,
      this.escalation,
      undefined,
      undefined,
      undefined,
      this.styleRepo,
    );
  }

  /** Delivers one user message and returns the coach's reply. */
  async send(text: string): Promise<string> {
    const inbound = await this.conversationRepo.saveMessage({
      conversationId: CONVERSATION_ID,
      tenantId: TENANT_ID,
      userId: USER_ID,
      direction: 'inbound',
      text,
    });

    const result = await this.orchestrator.orchestrate({
      messageId: inbound.id,
      conversationId: CONVERSATION_ID,
      userId: USER_ID,
      tenantId: TENANT_ID,
      externalWorkspaceId: 'sim-workspace',
      externalConversationId: 'sim-channel',
      traceId: `sim-turn-${this.turns.length + 1}`,
    });

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

  detectRisk(turns: ConversationTurn[], context: RiskContext): Promise<RiskDetection> {
    return this.delegate.detectRisk(turns, context);
  }

  extractMemory(turns: ConversationTurn[], existing: MemoryContext): Promise<MemoryProposal> {
    return this.delegate.extractMemory(turns, existing);
  }

  evaluateSurveyEvidence(
    turns: ConversationTurn[],
    questions: SurveyQuestionForEvaluation[],
  ): Promise<SurveyEvidenceEvaluation> {
    return this.delegate.evaluateSurveyEvidence(turns, questions);
  }

  async generateResponse(
    turns: ConversationTurn[],
    strategy: ReplyStrategy,
    context: ResponseContext,
  ): Promise<GeneratedResponse> {
    this.generateCalls.push({ turns, strategy, context });
    return this.delegate.generateResponse(turns, strategy, context);
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
