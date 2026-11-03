import {
  ConversationOrchestrator,
  type AiProviderPort,
  type ConversationRecord,
  type EscalationEvent,
  type EscalationPort,
  type MemoryItemRecord,
  type MessageRecord,
  type OnboardingTurnPort,
  type OrchestrateResult,
  type ScheduledActionRepositoryPort,
  type SurveyRepositoryPort,
  type QuestionConfirmationPort,
  type PulseBacklogService,
  type StyleProfileRecord,
} from '@entalent/application';
import { OpenAiProvider } from '@entalent/ai-openai';
import {
  InMemoryConversationRepository,
  InMemoryGoalRepository,
  InMemoryMemoryRepository,
  InMemoryScheduledActionRepository,
  InMemoryStyleProfileRepository,
} from '../fakes/repositories';
import { InlineOutbox } from '../fakes/inline-outbox';
import { registerFallbackReport } from './report';
import {
  describeError,
  describeOutcome,
  summarizeValue,
  traceWrites,
  TracingAiProvider,
  TurnTrace,
  type GenerateResponseCall,
  type TurnEffects,
} from '@entalent/conversation-trace';

const TENANT_ID = 'sim-tenant';
const USER_ID = 'sim-user';
const CONVERSATION_ID = 'sim-conversation';
/** Ids every harness conversation uses; seeders write records under them. */
export const SIM_SCOPE = { tenantId: TENANT_ID, userId: USER_ID, conversationId: CONVERSATION_ID } as const;

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
  /** Defaults to an in-memory store, as production always wires one: reminders are scheduled and confirmed. */
  scheduledActionRepo?: ScheduledActionRepositoryPort;
  surveyRepo?: SurveyRepositoryPort;
  onboardingTurn?: OnboardingTurnPort;
  /** V2 question-confirmation state (ready bundles, clarifications); omitted means no V2 turns. */
  questionConfirmationRepo?: QuestionConfirmationPort;
  /** Topic selection for the pulse cycle (GC round 3 CAP-1); omitted means no topic questions. */
  pulseBacklogService?: Pick<PulseBacklogService, 'getNextProbeQuestion'>;
  /** Set by `harnessFromPrecondition`: the starting state the report's Given block shows. */
  precondition?: PreconditionSummary;
}

/** Readable starting state of a run built from a precondition file (see `src/preconditions`). */
export interface PreconditionSummary {
  name: string;
  /** File the precondition was loaded from; null when it was built in code. */
  source: string | null;
  origin: string;
  presets: string[];
  user: string;
  startTime: string | null;
  elapsedMinutes: number | null;
  goals: string[];
  styleProfile: string | null;
  onboarding: string | null;
  cycle: {
    open: boolean;
    topicsTotal: number;
    topicsClosed: number;
    openTopics: string[];
    /** One line per topic: `group: status, status`. */
    topics: string[];
    nextProbe: string | null;
  } | null;
  evidence: string[];
  scheduledActions: string[];
}

/** A QA test file's metadata and results (see `src/qa`), carried into the run report. */
export interface QaRunSummary {
  /** QA test file, relative to the package when possible. */
  file: string;
  id: string;
  title: string;
  jira: string | null;
  story: string | null;
  tags: string[];
  precondition: string;
  /** One per expected result; `met: null` means the judge gave no verdict on it (not run, or the line was missing). */
  expectations: Array<{ text: string; met: boolean | null }>;
  hardChecks: Array<{ check: string; label: string; met: boolean; actual: string }>;
}

export type { GenerateResponseCall, TurnEffects } from '@entalent/conversation-trace';

/** What the conversation looked like before the scenario's first message. */
export interface ScenarioContext {
  setup: string[];
  messages: Array<{ direction: string; text: string; notes: string[] }>;
  memory: Array<{ category: string; content: string }>;
  /** Present when the run was built from a precondition file. */
  precondition?: PreconditionSummary;
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
  /** Reminders and other scheduled actions the turns created. */
  readonly scheduledActions: ScheduledActionRepositoryPort;
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
  /** Ordered model calls, writes and warnings of every turn, for the readable report. */
  readonly trace = new TurnTrace();
  /** The employee message of each `send`, including a turn that threw. */
  readonly userMessages: string[] = [];
  /** One entry per completed turn, parallel to `turns`. */
  readonly turnEffects: TurnEffects[] = [];
  /** Set by the QA test runner; the run report copies it. */
  qa: QaRunSummary | null = null;
  /** Messages already in the conversation when the first `send` started: the scenario's seeded history. */
  private seedMessageCount: number | null = null;

  private readonly orchestrator: ConversationOrchestrator;

  constructor(private readonly options: CoachHarnessOptions = {}) {
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
    this.scheduledActions = options.scheduledActionRepo ?? new InMemoryScheduledActionRepository();

    const trace = this.trace;
    const ai = new RecordingAiProvider(
      options.aiProvider ?? createLiveProvider(),
      this.generateResponseCalls,
      trace,
    );
    // The orchestrator and the inline outbox write through traced views of the same stores.
    const conversationRepo = traceWrites(this.conversationRepo, 'conversation', trace);
    const memoryRepo = traceWrites(this.memoryRepo, 'memory', trace);
    const goalRepo = traceWrites(this.goalRepo, 'goals', trace);
    const styleRepo = traceWrites(this.styleRepo, 'style', trace);
    this.outbox = new InlineOutbox(
      ai,
      conversationRepo,
      memoryRepo,
      goalRepo,
      styleRepo,
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

    const optional = <T extends object>(port: T | undefined, store: string): T | undefined =>
      port ? traceWrites(port, store, trace) : undefined;
    this.orchestrator = new ConversationOrchestrator(
      conversationRepo,
      ai,
      traceWrites(this.outbox, 'outbox', trace),
      memoryRepo,
      optional(options.surveyRepo, 'survey') ?? {
        findPulseCaptureForConversation: async () => [],
        findAwaitingConfirmationGroups: async () => [],
        findPendingConfirmationGroups: async () => [],
      } as unknown as SurveyRepositoryPort,
      undefined,
      traceWrites(this.escalation, 'escalation', trace),
      undefined,
      traceWrites(this.scheduledActions, 'scheduledActions', trace),
      options.pulseBacklogService as PulseBacklogService | undefined,
      styleRepo,
      goalRepo,
      optional(options.questionConfirmationRepo, 'questionConfirmation'),
      undefined,
      optional(options.onboardingTurn, 'onboarding'),
      { warn: (message, context) => trace.record('warning', message, context ? summarizeValue(context, 0) : '') },
    );

    // A report must exist even when the scenario aborts before `reportRun` is reached.
    registerFallbackReport(this);
  }

  /** Delivers one user message and returns the coach's reply. */
  async send(text: string): Promise<string> {
    const generationStart = this.generateResponseCalls.length;
    this.trace.turn = this.turns.length + 1;
    this.seedMessageCount ??= this.conversationRepo.messages.length;
    this.userMessages.push(text);
    const memoryBefore = this.memoryRepo.items.length;
    const escalationsBefore = this.escalation.events.length;
    const inbound = await this.conversationRepo.saveMessage({
      conversationId: CONVERSATION_ID,
      tenantId: TENANT_ID,
      userId: USER_ID,
      direction: 'inbound',
      text,
    });

    const turn = this.turns.length + 1;
    this.trace.record('inbound', 'message accepted', `saved as inbound, ${text.length} chars`);
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
      this.trace.record('error', 'orchestrate', describeError(error));
      throw error;
    }
    this.trace.record('decision', 'turn outcome', describeOutcome(result, this.generateResponseCalls.length > generationStart));

    this.responseCallsByTurn.push(
      this.generateResponseCalls.length > generationStart
        ? this.generateResponseCalls[this.generateResponseCalls.length - 1]!
        : null,
    );
    this.turns.push(result);
    const outbound = this.conversationRepo.messages.find((message) => message.id === result.outboundMessageId);
    this.turnEffects.push({
      outboundMetadata: outbound?.metadata ? { ...outbound.metadata } : null,
      memoryAdded: this.memoryRepo.items.slice(memoryBefore).map((item) => ({
        category: item.category, content: item.content, importance: item.importance,
      })),
      escalations: this.escalation.events.slice(escalationsBefore).map((event) => ({
        type: event.type, severity: event.severity, riskType: event.riskType,
      })),
      generationAttempts: this.generateResponseCalls.length - generationStart,
    });
    return result.responseText;
  }

  get replies(): string[] {
    return this.turns.map((t) => t.responseText);
  }

  /** What the conversation started from, shown as the report's context block. */
  get context(): ScenarioContext {
    const o = this.options;
    return {
      setup: [
        `user ${o.userName ?? 'Alex'}, timezone ${o.timezone ?? 'Europe/Berlin'}`,
        o.seedMemory?.length ? `${o.seedMemory.length} memory item(s) seeded` : null,
        o.seedStyleProfile ? 'style profile seeded' : null,
        o.analyzeStyle ? 'style analysis on' : null,
        o.aiProvider ? 'custom AI provider (not the live one)' : null,
        o.scheduledActionRepo ? 'scheduled actions: scenario repository' : null,
        o.surveyRepo ? 'survey repository' : null,
        o.onboardingTurn ? 'onboarding v2 enabled' : null,
        o.questionConfirmationRepo ? 'V2 question confirmation enabled' : null,
        o.pulseBacklogService ? 'pulse cycle open (topic backlog service)' : null,
        o.precondition ? `precondition ${o.precondition.name}` : null,
      ].filter((fact): fact is string => fact !== null),
      messages: this.conversationRepo.messages.slice(0, this.seedMessageCount ?? undefined).map((message) => ({
        direction: message.direction,
        text: message.text,
        notes: Object.entries(message.metadata ?? {}).map(([key, value]) => `${key}=${JSON.stringify(value)}`.slice(0, 120)),
      })),
      memory: this.memoryItems
        .filter((item) => item.sourceMessageIds.length === 0)
        .map((item) => ({ category: item.category, content: item.content })),
      ...(o.precondition ? { precondition: o.precondition } : {}),
    };
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

/** Exported for tests; scenarios reach it only through `CoachHarness`. Keeps every generation request. */
export class RecordingAiProvider extends TracingAiProvider {
  constructor(
    delegate: AiProviderPort,
    generateCalls: GenerateResponseCall[],
    trace: TurnTrace = new TurnTrace(),
  ) {
    super(delegate, trace, (call) => generateCalls.push(call));
  }
}

function describeFailure(error: unknown, turn: number, generationCalls: number): AgentTurnFailure {
  if (error instanceof Error) {
    return { turn, name: error.name, message: error.message, stack: error.stack ?? null, generationCalls };
  }
  return { turn, name: typeof error, message: String(error), stack: null, generationCalls };
}

/** Mirrors `AiService` in the worker so simulations exercise the shipped provider setup. */
export function createLiveProvider(): AiProviderPort {
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
