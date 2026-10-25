import {
  MemoryExtractionUseCase,
  systemClock,
  StyleAnalysisUseCase,
  SurveyEvidenceExtractionUseCase,
  type AiProviderPort,
  type ClockPort,
  type ConversationRepositoryPort,
  type GoalRepositoryPort,
  type MemoryExtractionPayload,
  type MemoryRepositoryPort,
  type MessageSendPayload,
  type OutboxPort,
  type StyleAnalysisPayload,
  type StyleProfileRepositoryPort,
  type SurveyEvidencePayload,
  type SurveyRepositoryPort,
} from '@entalent/application';

export interface InlineOutboxOptions {
  /** Style analysis costs one extra LLM call per turn; off by default. */
  analyzeStyle?: boolean;
  /** Source of the delivery `sentAt` stamp; defaults to the system clock. */
  clock?: ClockPort;
  /**
   * Runs `SurveyEvidenceExtractionUseCase` inline over this outbox's AI provider and
   * conversation repository and the given survey repository (v1 path: no question-capture
   * port). Omitted means survey evidence is not extracted.
   */
  surveyEvidence?: { surveyRepo: SurveyRepositoryPort };
}

/**
 * Runs the queue-backed side effects that shape later turns (memory extraction,
 * style analysis) synchronously with the real use cases, so a simulated
 * conversation carries the same accumulated state a production one would.
 * Effects that only reach external systems are recorded, not executed.
 */
export class InlineOutbox implements OutboxPort {
  readonly sentMessages: MessageSendPayload[] = [];
  /** Survey-evidence extractions that threw, as `Name: message`; the reply already persisted. */
  readonly surveyEvidenceFailures: string[] = [];

  private readonly memoryExtraction: MemoryExtractionUseCase;
  private readonly styleAnalysis: StyleAnalysisUseCase;
  private readonly surveyEvidence: SurveyEvidenceExtractionUseCase | null;

  constructor(
    ai: AiProviderPort,
    private readonly conversationRepo: ConversationRepositoryPort,
    memoryRepo: MemoryRepositoryPort,
    goalRepo: GoalRepositoryPort,
    styleRepo: StyleProfileRepositoryPort,
    private readonly options: InlineOutboxOptions = {},
  ) {
    this.memoryExtraction = new MemoryExtractionUseCase(conversationRepo, memoryRepo, goalRepo, ai);
    this.styleAnalysis = new StyleAnalysisUseCase(ai, conversationRepo, styleRepo);
    this.surveyEvidence = options.surveyEvidence
      ? new SurveyEvidenceExtractionUseCase(ai, conversationRepo, options.surveyEvidence.surveyRepo)
      : null;
  }

  async enqueueMessageSend(payload: MessageSendPayload): Promise<void> {
    this.sentMessages.push(payload);
    await this.conversationRepo.updateMessageDelivery(payload.messageId, {
      tenantId: payload.tenantId,
      conversationId: payload.conversationId,
      externalMessageId: `sim:${payload.messageId}`,
      sentAt: (this.options.clock ?? systemClock).now(),
    });
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

  async enqueueSurveyEvidence(payload: SurveyEvidencePayload): Promise<void> {
    // Without a survey repository (the default harness) survey evidence is not extracted.
    if (!this.surveyEvidence) return;
    const { conversationId, userId, tenantId, inboundMessageId } = payload;
    // Production runs this in the worker, isolated from the reply: a failure is recorded, not thrown.
    try {
      if (payload.mode === 'backfill') {
        await this.surveyEvidence.backfill({ conversationId, userId, tenantId });
        return;
      }
      await this.surveyEvidence.execute({ conversationId, userId, tenantId, inboundMessageId });
    } catch (error) {
      this.surveyEvidenceFailures.push(error instanceof Error ? `${error.name}: ${error.message}` : String(error));
    }
  }

  async enqueueGroupReport(): Promise<void> {
    // Team-level reporting is out of scope for a single-user simulation.
  }

  async enqueueProfileHydration(): Promise<void> {
    // Timezone comes from the seeded conversation record instead of Slack.
  }
}
