import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { MemoryExtractionUseCase, FollowUpSchedulerUseCase } from '@entalent/application';
import type { MemoryExtractionPayload } from '@entalent/application';
import { QUEUE_NAMES } from '../queue/queue.module';

@Processor(QUEUE_NAMES.MEMORY_EXTRACTION)
export class MemoryExtractionProcessor extends WorkerHost {
  private readonly logger = new Logger(MemoryExtractionProcessor.name);

  constructor(
    private readonly useCase: MemoryExtractionUseCase,
    private readonly scheduler: FollowUpSchedulerUseCase,
  ) {
    super();
  }

  async process(job: Job<MemoryExtractionPayload>): Promise<void> {
    const d = job.data;
    this.logger.log(`Memory extraction job=${job.id} traceId=${d.traceId}`);

    let result;
    try {
      result = await this.useCase.execute({
      conversationId: d.conversationId,
      userId: d.userId,
      tenantId: d.tenantId,
      inboundMessageId: d.inboundMessageId,
      outboundMessageId: d.outboundMessageId,
      channelType: d.channelType,
      externalConversationId: d.externalConversationId,
    });
    } catch (err) {
      this.logger.error(`Memory extraction job=${job.id} failed: ${(err as Error).message}`, (err as Error).stack);
      throw err;
    }

    if (result.followUpCandidates.length > 0) {
      await this.scheduler.schedule({
        candidates: result.followUpCandidates,
        userId: d.userId,
        tenantId: d.tenantId,
        conversationId: d.conversationId,
        channelType: d.channelType,
        externalConversationId: d.externalConversationId,
        inboundMessageId: d.inboundMessageId,
      });
    }

    this.logger.log(
      `Memory extraction complete job=${job.id} traceId=${d.traceId} followUpCandidates=${result.followUpCandidates.length}`,
    );
  }
}
