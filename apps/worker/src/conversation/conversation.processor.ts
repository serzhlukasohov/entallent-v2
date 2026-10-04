import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, OnApplicationShutdown } from '@nestjs/common';
import { Job, type Queue } from 'bullmq';
import { eq } from 'drizzle-orm';
import {
  ConversationOrchestrator,
  ProactiveCheckInUseCase,
} from '@entalent/application';
import type { ProactivePulseConfig } from '@entalent/application';
import { tenants } from '@entalent/database';
import { DatabaseService } from '../database/database.service';
import { QUEUE_NAMES } from '../queue/queue.module';
import { LlmRunRepository } from './llm-run.repository';
import { ConversationRepository } from './repositories/conversation.repository';
import { SurveyRepository } from '../survey/repositories/survey.repository';

export type ConversationJob = {
  requestId: string;
  eventId: string;
  messageId: string;
  conversationId: string;
  userId: string;
  tenantId: string;
  externalWorkspaceId: string;
  externalConversationId: string;
  traceId: string;
  rapidMessageCoalescing?: true;
};

export type CheckInJob = Omit<ConversationJob, 'requestId' | 'eventId' | 'messageId'>;
type ReceiptRetryJob = Pick<ConversationJob, 'messageId' | 'conversationId' | 'userId' | 'tenantId'>;

const DEFAULT_PULSE_CONFIG: ProactivePulseConfig = { ignoreWindowHours: 48 };
const RAPID_MESSAGE_COALESCING_WINDOW_MS = 2_000;

@Processor(QUEUE_NAMES.CONVERSATION)
export class ConversationProcessor extends WorkerHost implements OnApplicationShutdown {
  private readonly logger = new Logger(ConversationProcessor.name);

  constructor(
    private readonly orchestrator: ConversationOrchestrator,
    private readonly checkInUseCase: ProactiveCheckInUseCase,
    private readonly llmRunRepo: LlmRunRepository,
    private readonly db: DatabaseService,
    private readonly conversationRepo: ConversationRepository,
    private readonly surveyRepo: SurveyRepository,
    @InjectQueue(QUEUE_NAMES.CONVERSATION) private readonly queue: Queue,
  ) {
    super();
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker.close();
  }

  async process(job: Job<ConversationJob | CheckInJob | ReceiptRetryJob>): Promise<void> {
    if (job.name === 'check-in') {
      await this.processCheckIn(job as Job<CheckInJob>);
      return;
    }
    if (job.name === 'receipt-retry') {
      await this.settleInbound(job.data as ReceiptRetryJob, true);
      return;
    }
    await this.processInbound(job as Job<ConversationJob>);
  }

  private async processCheckIn(job: Job<CheckInJob>): Promise<void> {
    this.logger.log(`Processing check-in job ${job.id}`, {
      conversationId: job.data.conversationId,
    });

    try {
      if (!await this.conversationRepo.isUserRuntimeEligible(job.data.tenantId, job.data.userId)) {
        this.logger.log(`Skipping check-in for inactive runtime user ${job.data.userId}`);
        return;
      }
      const [tenantRow] = await this.db.client
        .select({ policy: tenants.proactiveMessagingPolicy })
        .from(tenants)
        .where(eq(tenants.id, job.data.tenantId))
        .limit(1);

      const policy = (tenantRow?.policy ?? {}) as Record<string, unknown>;
      const testQuestionGroup = normalizeOptionalString(process.env.PULSE_TEST_QUESTION_GROUP);
      const pulseConfig: ProactivePulseConfig = {
        ignoreWindowHours:
          typeof policy['ignoreWindowHours'] === 'number'
            ? policy['ignoreWindowHours']
            : DEFAULT_PULSE_CONFIG.ignoreWindowHours,
        ...(testQuestionGroup ? { questionGroup: testQuestionGroup } : {}),
      };

      const result = await this.checkInUseCase.execute({ ...job.data, pulseConfig });
      this.logger.log(
        `Check-in job ${job.id} done — probe=${result.probeQuestionId ?? 'none'}`,
      );
    } catch {
      this.logger.error(`Check-in job ${job.id} failed: check_in_processing_failed`);
      throw new Error('check_in_processing_failed');
    }
  }

  private async processInbound(job: Job<ConversationJob>): Promise<void> {
    this.logger.log(`Processing conversation job ${job.id}`, {
      messageId: job.data.messageId,
      conversationId: job.data.conversationId,
    });

    const pendingQuestionReply = await this.surveyRepo.hasUnresolvedQuestionConfirmationForInbound(job.data);
    if (await this.orchestrator.resumeCommittedTurn?.(job.data)) {
      await this.settleInbound(job.data, pendingQuestionReply);
      this.logger.log(`Committed conversation turn resumed for job ${job.id}`);
      return;
    }
    if (!await this.conversationRepo.isUserRuntimeEligible(job.data.tenantId, job.data.userId)) {
      this.logger.log(`Skipping conversation job for inactive runtime user ${job.data.userId}`);
      await this.settleInbound(job.data, pendingQuestionReply);
      return;
    }

    if (
      job.data.rapidMessageCoalescing === true && !pendingQuestionReply &&
      await this.conversationRepo.shouldSkipInboundMessage({
        messageId: job.data.messageId,
        conversationId: job.data.conversationId,
        userId: job.data.userId,
        tenantId: job.data.tenantId,
        windowMs: RAPID_MESSAGE_COALESCING_WINDOW_MS,
      })
    ) {
      this.logger.log(`Skipping stale conversation job ${job.id}`);
      await this.settleInbound(job.data, pendingQuestionReply);
      return;
    }

    const start = Date.now();
    let status: 'success' | 'error' = 'success';

    try {
      const result = await this.orchestrator.orchestrate(job.data);
      try {
        await this.settleInbound(job.data, pendingQuestionReply);
      } catch {
        // Orchestration already persisted and queued its outbound effects. Retry only
        // the content-free receipt so a BullMQ retry cannot send a second response.
        try {
          await this.queue.add('receipt-retry', {
            messageId: job.data.messageId,
            conversationId: job.data.conversationId,
            userId: job.data.userId,
            tenantId: job.data.tenantId,
          } satisfies ReceiptRetryJob, {
            jobId: `receipt-${job.data.messageId}`,
            attempts: 10,
            backoff: { type: 'exponential', delay: 1_000 },
          });
          this.logger.warn(`Conversation receipt retry queued for job ${job.id}`);
        } catch {
          // Completing this job preserves proof that orchestration finished.
          // The cutoff scanner will enqueue the receipt-only retry later.
          this.logger.error('Conversation receipt retry deferred: receipt_retry_enqueue_failed');
        }
      }

      this.logger.log(
        `Job ${job.id} done — mode=${result.mode} intent=${result.classification.primaryIntent} risk=${result.risk.severity}`,
      );
    } catch {
      status = 'error';
      this.logger.error(`Job ${job.id} failed (attempt ${job.attemptsMade}): conversation_processing_failed`);
      throw new Error('conversation_processing_failed');
    } finally {
      await this.llmRunRepo
        .record({
          tenantId: job.data.tenantId,
          userId: job.data.userId,
          taskType: 'conversation',
          model: 'gpt-4o',
          latencyMs: Date.now() - start,
          status,
          traceId: job.data.traceId,
        })
        .catch(() => {
          /* non-critical */
        });
    }
  }

  private async settleInbound(input: ReceiptRetryJob, pendingQuestionReply: boolean): Promise<void> {
    await this.conversationRepo.markInboundConversationJobProcessed(input);
    if (!pendingQuestionReply) return;
    try {
      await this.surveyRepo.expireTemporaryQuestionInsightsForClosedWindows({
        tenantId: input.tenantId,
        now: new Date(),
      });
    } catch {
      // The recurring cutoff retries cleanup independently of conversation delivery.
      this.logger.error('Post-conversation question cutoff failed: question_cutoff_retry_required');
    }
  }
}

function normalizeOptionalString(value: string | null | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}
