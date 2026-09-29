import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { FinalizeQuestionInsightUseCase, SurveyEvidenceExtractionUseCase } from '@entalent/application';
import type { SurveyEvidencePayload } from '@entalent/application';
import { QUEUE_NAMES } from '../queue/queue.module';
import { SurveyEvidenceIntentRepository } from './repositories/survey-evidence-intent.repository';

@Processor(QUEUE_NAMES.SURVEY_EVIDENCE)
export class SurveyEvidenceProcessor extends WorkerHost {
  private readonly logger = new Logger(SurveyEvidenceProcessor.name);

  constructor(
    private readonly useCase: SurveyEvidenceExtractionUseCase,
    private readonly finalizer: FinalizeQuestionInsightUseCase,
    private readonly intentRepo?: SurveyEvidenceIntentRepository,
  ) {
    super();
  }

  async process(job: Job<SurveyEvidencePayload>): Promise<void> {
    const { conversationId, userId, tenantId, inboundMessageId, traceId, mode } = job.data;
    this.logger.debug(`Processing survey evidence for conversation ${conversationId} [${traceId}] mode=${mode ?? 'live'}`);

    try {
      await this.useCase.assertConversationOwner({ conversationId, userId, tenantId });
      const source = { conversationId, userId, tenantId, inboundMessageId };
      const intentStatus = mode === 'backfill' || !this.intentRepo
        ? 'legacy' : await this.intentRepo.status(source);
      if (intentStatus === 'complete') return;
      try {
        await this.finalizer.executePending({ tenantId, userId });
      } catch {
        // BullMQ persists failure reasons. Never put private model output there.
        throw new Error('v2_question_finalization_failed');
      }
      if (mode === 'backfill') {
        const { windowsProcessed } = await this.useCase.backfill({ conversationId, userId, tenantId });
        this.logger.log(`Survey evidence backfill processed ${windowsProcessed} windows for conversation ${conversationId} [${traceId}]`);
      } else {
        if (intentStatus === 'pending') {
          const prepared = await this.useCase.prepare(source);
          await this.intentRepo!.complete(source, () => prepared
            ? this.useCase.apply(source, prepared) : Promise.resolve());
        } else {
          await this.useCase.execute(source);
        }
      }
    } catch (err) {
      const reason = err instanceof Error && err.message === 'v2_question_finalization_failed'
        ? 'v2_question_finalization_failed'
        : 'survey_evidence_processing_failed';
      this.logger.error(`Survey evidence processing failed [${traceId}]: ${reason}`);
      throw new Error(reason);
    }
  }
}
