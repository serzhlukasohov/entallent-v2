import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, OnApplicationShutdown } from '@nestjs/common';
import { Job } from 'bullmq';
import { ConversationOrchestrator, ProactiveCheckInUseCase } from '@entalent/application';
import { QUEUE_NAMES } from '../queue/queue.module';
import { LlmRunRepository } from './llm-run.repository';

export type ConversationJob = {
  messageId: string;
  conversationId: string;
  userId: string;
  tenantId: string;
  externalWorkspaceId: string;
  externalConversationId: string;
  traceId: string;
};

export type CheckInJob = Omit<ConversationJob, 'messageId'>;

@Processor(QUEUE_NAMES.CONVERSATION)
export class ConversationProcessor extends WorkerHost implements OnApplicationShutdown {
  private readonly logger = new Logger(ConversationProcessor.name);

  constructor(
    private readonly orchestrator: ConversationOrchestrator,
    private readonly checkInUseCase: ProactiveCheckInUseCase,
    private readonly llmRunRepo: LlmRunRepository,
  ) {
    super();
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker.close();
  }

  async process(job: Job<ConversationJob | CheckInJob>): Promise<void> {
    if (job.name === 'check-in') {
      await this.processCheckIn(job as Job<CheckInJob>);
      return;
    }
    await this.processInbound(job as Job<ConversationJob>);
  }

  private async processCheckIn(job: Job<CheckInJob>): Promise<void> {
    this.logger.log(`Processing check-in job ${job.id}`, {
      conversationId: job.data.conversationId,
    });

    try {
      const result = await this.checkInUseCase.execute(job.data);
      this.logger.log(
        `Check-in job ${job.id} done — probe=${result.probeQuestionId ?? 'none'} text="${result.responseText.slice(0, 60)}"`,
      );
    } catch (err) {
      this.logger.error(`Check-in job ${job.id} failed: ${(err as Error).message}`, (err as Error).stack);
      throw err;
    }
  }

  private async processInbound(job: Job<ConversationJob>): Promise<void> {
    this.logger.log(`Processing conversation job ${job.id}`, {
      messageId: job.data.messageId,
      conversationId: job.data.conversationId,
    });

    const start = Date.now();
    let status: 'success' | 'error' = 'success';

    try {
      const result = await this.orchestrator.orchestrate({
        messageId: job.data.messageId,
        conversationId: job.data.conversationId,
        userId: job.data.userId,
        tenantId: job.data.tenantId,
        externalWorkspaceId: job.data.externalWorkspaceId,
        externalConversationId: job.data.externalConversationId,
        traceId: job.data.traceId,
      });

      this.logger.log(
        `Job ${job.id} done — mode=${result.mode} intent=${result.classification.primaryIntent} risk=${result.risk.severity}`,
      );
    } catch (err) {
      status = 'error';
      this.logger.error(`Job ${job.id} failed (attempt ${job.attemptsMade}): ${(err as Error).message}`, (err as Error).stack);
      throw err;
    } finally {
      await this.llmRunRepo.record({
        tenantId: job.data.tenantId,
        userId: job.data.userId,
        taskType: 'conversation',
        model: 'gpt-4o',
        latencyMs: Date.now() - start,
        status,
        traceId: job.data.traceId,
      }).catch(() => { /* non-critical: don't fail the job on recording errors */ });
    }
  }
}
