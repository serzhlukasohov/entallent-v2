import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { OnboardingActionJobSchema, type OnboardingActionJob } from '@entalent/contracts';
import { QUEUE_NAMES } from '../queue/queue.module';
import { OnboardingService } from './onboarding.service';

/**
 * Applies a validated Slack button click. A click is a state event only; it is never
 * persisted as an inbound user message.
 */
@Processor(QUEUE_NAMES.ONBOARDING_ACTION)
export class OnboardingActionProcessor extends WorkerHost {
  private readonly logger = new Logger(OnboardingActionProcessor.name);

  constructor(private readonly onboarding: OnboardingService) {
    super();
  }

  async process(job: Job<OnboardingActionJob>): Promise<void> {
    const { tenantId, personId, action, actionTs } = OnboardingActionJobSchema.parse(job.data);
    const at = new Date(Number(actionTs) * 1000);
    if (Number.isNaN(at.getTime())) throw new Error(`Invalid onboarding action timestamp: ${actionTs}`);
    const result = await this.onboarding.apply(tenantId, personId, { type: 'action', action, source: 'button', at });
    this.logger.log(`Onboarding button action=${action} person=${personId} changed=${result.changed}`);
  }
}
