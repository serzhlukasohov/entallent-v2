import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { FollowUpExecutionUseCase } from '@entalent/application';
import type { FollowUpExecutionPayload } from '@entalent/application';
import { QUEUE_NAMES } from '../queue/queue.module';

@Processor(QUEUE_NAMES.FOLLOWUP_EXECUTION)
export class FollowUpExecutionProcessor extends WorkerHost {
  private readonly logger = new Logger(FollowUpExecutionProcessor.name);

  constructor(private readonly useCase: FollowUpExecutionUseCase) {
    super();
  }

  async process(job: Job<FollowUpExecutionPayload>): Promise<void> {
    const { scheduledActionId, tenantId, userId } = job.data;

    this.logger.log(`Follow-up execution actionId=${scheduledActionId}`);

    let result: Awaited<ReturnType<FollowUpExecutionUseCase['execute']>>;
    try {
      result = await this.useCase.execute({ scheduledActionId, tenantId, userId });
    } catch {
      this.logger.error(`Follow-up execution failed actionId=${scheduledActionId}`);
      throw new Error('follow_up_execution_failed');
    }

    this.logger.log(
      `Follow-up execution done actionId=${scheduledActionId} decision=${result.decision} reason=${result.reason}`,
    );
  }
}
