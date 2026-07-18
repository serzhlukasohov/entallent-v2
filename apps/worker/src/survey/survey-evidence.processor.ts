import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { SurveyEvidenceExtractionUseCase } from '@entalent/application';
import type { SurveyEvidencePayload } from '@entalent/application';
import { QUEUE_NAMES } from '../queue/queue.module';

@Processor(QUEUE_NAMES.SURVEY_EVIDENCE)
export class SurveyEvidenceProcessor extends WorkerHost {
  private readonly logger = new Logger(SurveyEvidenceProcessor.name);

  constructor(private readonly useCase: SurveyEvidenceExtractionUseCase) {
    super();
  }

  async process(job: Job<SurveyEvidencePayload>): Promise<void> {
    const { conversationId, userId, tenantId, inboundMessageId, traceId } = job.data;
    this.logger.debug(`Processing survey evidence for conversation ${conversationId} [${traceId}]`);

    try {
      await this.useCase.execute({ conversationId, userId, tenantId, inboundMessageId });
    } catch (err) {
      this.logger.error(`Survey evidence extraction failed [${traceId}]:`, err);
      throw err;
    }
  }
}
