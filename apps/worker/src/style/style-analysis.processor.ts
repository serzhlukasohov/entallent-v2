import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { StyleAnalysisUseCase } from '@entalent/application';
import type { StyleAnalysisPayload } from '@entalent/application';
import { QUEUE_NAMES } from '../queue/queue.module';

@Processor(QUEUE_NAMES.STYLE_ANALYSIS)
export class StyleAnalysisProcessor extends WorkerHost {
  private readonly logger = new Logger(StyleAnalysisProcessor.name);
  constructor(private readonly useCase: StyleAnalysisUseCase) { super(); }

  async process(job: Job<StyleAnalysisPayload>): Promise<void> {
    const { conversationId, userId, tenantId, traceId } = job.data;
    try {
      await this.useCase.execute({ conversationId, userId, tenantId });
    } catch (err) {
      this.logger.error(`Style analysis failed [${traceId}]: ${(err as Error).message}`, (err as Error).stack);
      throw err;
    }
  }
}
