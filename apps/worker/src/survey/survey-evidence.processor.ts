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
    const { conversationId, userId, tenantId, inboundMessageId, traceId, mode } = job.data;
    this.logger.debug(`Processing survey evidence for conversation ${conversationId} [${traceId}] mode=${mode ?? 'live'}`);

    try {
      if (mode === 'backfill') {
        const { windowsProcessed } = await this.useCase.backfill({ conversationId, userId, tenantId });
        this.logger.log(`Survey evidence backfill processed ${windowsProcessed} windows for conversation ${conversationId} [${traceId}]`);
      } else {
        await this.useCase.execute({ conversationId, userId, tenantId, inboundMessageId });
      }
    } catch (err) {
      this.logger.error(
        `Survey evidence extraction failed [${traceId}]: ${(err as Error).message}`,
        (err as Error).stack,
      );
      throw err;
    }
  }
}
