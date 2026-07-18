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
    const { scheduledActionId, tenantId, userId, traceId } = job.data;

    this.logger.log(`Follow-up execution job=${job.id} actionId=${scheduledActionId} traceId=${traceId}`);

    const result = await this.useCase.execute({ scheduledActionId, tenantId, userId });

    this.logger.log(
      `Follow-up execution done job=${job.id} decision=${result.decision} reason=${result.reason}`,
    );
  }
}
