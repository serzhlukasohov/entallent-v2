import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { MemoryExtractionUseCase, FollowUpSchedulerUseCase } from '@entalent/application';
import type { MemoryExtractionPayload } from '@entalent/application';
import { QUEUE_NAMES } from '../queue/queue.module';
import { ConversationRepository } from '../conversation/repositories/conversation.repository';
import { MemoryExtractionIntentRepository } from './repositories/memory-extraction-intent.repository';

@Processor(QUEUE_NAMES.MEMORY_EXTRACTION)
export class MemoryExtractionProcessor extends WorkerHost {
  private readonly logger = new Logger(MemoryExtractionProcessor.name);

  constructor(
    private readonly useCase: MemoryExtractionUseCase,
    private readonly scheduler: FollowUpSchedulerUseCase,
    private readonly intentRepo: MemoryExtractionIntentRepository,
    private readonly conversationRepo: ConversationRepository,
  ) {
    super();
  }

  async process(job: Job<MemoryExtractionPayload>): Promise<void> {
    const d = job.data;
    this.logger.log(`Memory extraction job=${job.id}`);

    try {
      const input = {
        conversationId: d.conversationId,
        userId: d.userId,
        tenantId: d.tenantId,
        inboundMessageId: d.inboundMessageId,
        outboundMessageId: d.outboundMessageId,
        channelType: d.channelType,
        externalConversationId: d.externalConversationId,
      };
      const source = {
        inboundMessageId: d.inboundMessageId,
        conversationId: d.conversationId,
        tenantId: d.tenantId,
        userId: d.userId,
      };
      const status = await this.intentRepo.status(source);
      if (status !== 'legacy') {
        if (status === 'pending') {
          const prepared = await this.useCase.prepare(input);
          await this.intentRepo.complete(source, async () => {
            const result = prepared
              ? await this.useCase.apply(input, prepared)
              : { followUpCandidates: [] };
            return this.scheduler.stage({ ...input, candidates: result.followUpCandidates });
          });
        }
        const pending = await this.conversationRepo.findUnqueuedCommittedFollowUps(source);
        if (!pending) throw new Error('memory_extraction_turn_effect_missing');
        for (const action of pending) {
          await this.scheduler.dispatch({
            scheduledActionId: action.scheduledActionId,
            tenantId: d.tenantId,
            userId: d.userId,
            traceId: `sched-${action.scheduledActionId}`,
            dueAt: action.dueAt,
          });
          await this.conversationRepo.markCommittedDispatchQueued({
            ...source, kind: 'follow_up_execution', targetId: action.scheduledActionId,
          });
        }
        this.logger.log(`Memory extraction complete job=${job.id} committed=true`);
        return;
      }

      const result = await this.useCase.execute(input);

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
        `Memory extraction complete job=${job.id} followUpCandidates=${result.followUpCandidates.length}`,
      );
    } catch {
      this.logger.error(`Memory extraction job=${job.id} failed: memory_extraction_failed`);
      throw new Error('memory_extraction_failed');
    }
  }
}
