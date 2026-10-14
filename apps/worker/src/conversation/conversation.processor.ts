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
    let errorCode: string | undefined;

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

      if ('outcome' in result && result.outcome === 'input_filtered') {
        this.logger.warn(`Job ${job.id} done — outcome=input_filtered`);
      } else {
        this.logger.log(
          `Job ${job.id} done — mode=${result.mode} intent=${result.classification.primaryIntent} risk=${result.risk.severity}`,
        );
      }
    } catch (error) {
      status = 'error';
      errorCode = conversationFailureCode(error);
      this.logger.error(`Job ${job.id} failed (attempt ${job.attemptsMade}): ${errorCode}`);
      // Earlier attempts rethrow so a retry can still answer. On the last attempt the employee
      // gets one explicit fallback reply instead of silence (GC round 2 CAP-1).
      if (isFinalAttempt(job) && await this.commitFailedTurnFallback(job, errorCode, pendingQuestionReply)) return;
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
          errorCode,
          traceId: job.data.traceId,
        })
        .catch(() => {
          /* non-critical */
        });
    }
  }

  private async commitFailedTurnFallback(
    job: Job<ConversationJob>,
    failureCode: string,
    pendingQuestionReply: boolean,
  ): Promise<boolean> {
    try {
      await this.orchestrator.commitFailedTurn(job.data, failureCode);
    } catch {
      this.logger.error(`Job ${job.id} fallback reply failed: conversation_fallback_commit_failed`);
      return false;
    }
    this.logger.warn(`Job ${job.id} done — outcome=processing_failed failure=${failureCode}`);
    try {
      await this.settleInbound(job.data, pendingQuestionReply);
    } catch {
      // The fallback turn is committed and dispatched; a missing receipt only delays cutoff accounting.
      this.logger.error(`Job ${job.id} fallback receipt deferred: receipt_store_failed`);
    }
    return true;
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

function isFinalAttempt(job: Job): boolean {
  return job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
}

/**
 * Our own failures carry constant English messages; map them to stable codes. Message text is
 * never logged as-is, because provider or parser errors can echo employee content.
 */
const KNOWN_FAILURE_MESSAGES: ReadonlyArray<[string, string]> = [
  ['Generated response exceeds the question limit', 'conversation_reply_question_limit'],
  ['OpenAI returned a noncompliant numeric survey probe', 'conversation_reply_numeric_probe_invalid'],
  ['Confirmation response requires', 'conversation_reply_confirmation_invalid'],
  ['OpenAI response truncated', 'conversation_model_truncated'],
  ['OpenAI returned an empty response', 'conversation_model_empty'],
  ['Circuit OPEN', 'conversation_provider_circuit_open'],
];
const APPLICATION_ERROR_CODE = /^[a-z][a-z0-9_]{2,80}$/;

function conversationFailureCode(error: unknown): string {
  if (error instanceof SyntaxError) return 'conversation_invalid_json';
  if (typeof error !== 'object' || error === null) return 'conversation_unknown_error';
  if ('name' in error && error.name === 'ZodError') return 'conversation_invalid_model_shape';
  if ('name' in error && error.name === 'ProviderContentFilterError'
    && 'direction' in error && (error.direction === 'input' || error.direction === 'output')) {
    return `conversation_provider_content_filter_${error.direction}`;
  }
  if ('status' in error && typeof error.status === 'number'
    && Number.isInteger(error.status) && error.status >= 400 && error.status <= 599) {
    return `conversation_provider_http_${error.status}`;
  }
  if ('code' in error && typeof error.code === 'string' && /^[0-9A-Z]{5}$/.test(error.code)) {
    return `conversation_database_${error.code}`;
  }
  const message = 'message' in error && typeof error.message === 'string' ? error.message : '';
  if (APPLICATION_ERROR_CODE.test(message)) return `conversation_app_${message}`;
  const known = KNOWN_FAILURE_MESSAGES.find(([prefix]) => message.startsWith(prefix));
  if (known) return known[1];
  return 'conversation_unclassified_error';
}

function normalizeOptionalString(value: string | null | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}
