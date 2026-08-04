import {
  MemoryExtractionUseCase,
  StyleAnalysisUseCase,
  type AiProviderPort,
  type ConversationRepositoryPort,
  type GoalRepositoryPort,
  type MemoryExtractionPayload,
  type MemoryRepositoryPort,
  type MessageSendPayload,
  type OutboxPort,
  type StyleAnalysisPayload,
  type StyleProfileRepositoryPort,
} from '@entalent/application';

export interface InlineOutboxOptions {
  /** Style analysis costs one extra LLM call per turn; off by default. */
  analyzeStyle?: boolean;
}

/**
 * Runs the queue-backed side effects that shape later turns (memory extraction,
 * style analysis) synchronously with the real use cases, so a simulated
 * conversation carries the same accumulated state a production one would.
 * Effects that only reach external systems are recorded, not executed.
 */
export class InlineOutbox implements OutboxPort {
  readonly sentMessages: MessageSendPayload[] = [];

  private readonly memoryExtraction: MemoryExtractionUseCase;
  private readonly styleAnalysis: StyleAnalysisUseCase;

  constructor(
    ai: AiProviderPort,
    conversationRepo: ConversationRepositoryPort,
    memoryRepo: MemoryRepositoryPort,
    goalRepo: GoalRepositoryPort,
    styleRepo: StyleProfileRepositoryPort,
    private readonly options: InlineOutboxOptions = {},
  ) {
    this.memoryExtraction = new MemoryExtractionUseCase(conversationRepo, memoryRepo, goalRepo, ai);
    this.styleAnalysis = new StyleAnalysisUseCase(ai, conversationRepo, styleRepo);
  }

  async enqueueMessageSend(payload: MessageSendPayload): Promise<void> {
    this.sentMessages.push(payload);
  }

  async enqueueMemoryExtraction(payload: MemoryExtractionPayload): Promise<void> {
    await this.memoryExtraction.execute(payload);
  }

  async enqueueStyleAnalysis(payload: StyleAnalysisPayload): Promise<void> {
    if (!this.options.analyzeStyle) return;
    await this.styleAnalysis.execute(payload);
  }

  async enqueueFollowUpExecution(): Promise<void> {
    // Reminders fire on a schedule that a single simulation never reaches.
  }

  async enqueueSurveyEvidence(): Promise<void> {
    // Requires the survey repository, which the simulation harness omits.
  }

  async enqueueGroupReport(): Promise<void> {
    // Team-level reporting is out of scope for a single-user simulation.
  }

  async enqueueProfileHydration(): Promise<void> {
    // Timezone comes from the seeded conversation record instead of Slack.
  }
}
