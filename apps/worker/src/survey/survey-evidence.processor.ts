import { CaptureEngagementAnswerUseCase } from '@entalent/application';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, Optional } from '@nestjs/common';
import { Job } from 'bullmq';
import { FinalizeQuestionInsightUseCase, SurveyEvidenceExtractionUseCase } from '@entalent/application';
import type { SurveyEvidencePayload } from '@entalent/application';
import { QUEUE_NAMES } from '../queue/queue.module';
import { PulseReportProgressRepository } from './repositories/pulse-report-progress.repository';
import { SurveyEvidenceIntentRepository } from './repositories/survey-evidence-intent.repository';

@Processor(QUEUE_NAMES.SURVEY_EVIDENCE)
export class SurveyEvidenceProcessor extends WorkerHost {
  private readonly logger = new Logger(SurveyEvidenceProcessor.name);

  constructor(
    private readonly useCase: SurveyEvidenceExtractionUseCase,
    private readonly finalizer: FinalizeQuestionInsightUseCase,
    private readonly intentRepo?: SurveyEvidenceIntentRepository,
    @Optional() private readonly engagementCapture?: CaptureEngagementAnswerUseCase,
    @Optional() private readonly progress?: PulseReportProgressRepository,
  ) {
    super();
  }

  async process(job: Job<SurveyEvidencePayload>): Promise<void> {
    const { conversationId, userId, tenantId, inboundMessageId, traceId, mode } = job.data;
    this.logger.debug(`Processing survey evidence for conversation ${conversationId} [${traceId}] mode=${mode ?? 'live'}`);

    try {
      await this.useCase.assertConversationOwner({ conversationId, userId, tenantId });
      const source = { conversationId, userId, tenantId, inboundMessageId };
      const finalizationInput = { tenantId, userId,
        ...(mode === 'backfill' ? { scope: 'legacy_only' as const }
          : this.progress ? { scope: await this.progress.finalizationScope(source) } : {}),
      };
      if(mode==='finalize_only'){await this.finalizer.executePending(finalizationInput);return;}
      if (mode === 'backfill') await this.engagementCapture?.backfill({ tenantId, userId, conversationId });
    else await this.engagementCapture?.execute(source);
    const intentStatus = mode === 'backfill' || !this.intentRepo
        ? 'legacy' : await this.intentRepo.status(source);

      try {
        await this.finalizer.executePending(finalizationInput);
      } catch {
        // BullMQ persists failure reasons. Never put private model output there.
        throw new Error('v2_question_finalization_failed');
      }
      if (intentStatus === 'complete') return;
      if (mode === 'backfill') {
        const { windowsProcessed } = await this.useCase.backfill({ conversationId, userId, tenantId });
        this.logger.log(`Survey evidence backfill processed ${windowsProcessed} windows for conversation ${conversationId} [${traceId}]`);
      } else {
        if (intentStatus === 'pending') {
          const prepared = await this.useCase.prepare(source);
          await this.intentRepo!.complete(source, () => prepared
            ? this.useCase.apply(source, prepared) : Promise.resolve());
        } else {
          if (this.progress) {
            const prepared=await this.useCase.prepare(source);
            await this.progress.completeEvidence(source,()=>prepared?this.useCase.apply(source,prepared):Promise.resolve());
          } else await this.useCase.execute(source);
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
