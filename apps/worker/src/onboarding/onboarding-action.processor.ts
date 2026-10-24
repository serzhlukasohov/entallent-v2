import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import {
  OnboardingQueueJobSchema, type OnboardingActionJob, type OnboardingDevIntroJob, type OnboardingSystemJob,
} from '@entalent/contracts';
import { QUEUE_NAMES } from '../queue/queue.module';
import { OnboardingService } from './onboarding.service';
import { OnboardingDevIntroService } from './onboarding-dev-intro.service';
import { devJobsEnabled } from './dev-jobs';

/**
 * Applies a validated Slack button click or a system event published after a hierarchy change.
 * A click is a state event only; it is never persisted as an inbound user message.
 */
@Processor(QUEUE_NAMES.ONBOARDING_ACTION)
export class OnboardingActionProcessor extends WorkerHost {
  private readonly logger = new Logger(OnboardingActionProcessor.name);

  constructor(
    private readonly onboarding: OnboardingService,
    private readonly devIntro?: OnboardingDevIntroService,
  ) {
    super();
  }

  async process(job: Job<OnboardingActionJob | OnboardingSystemJob | OnboardingDevIntroJob>): Promise<void> {
    const data = OnboardingQueueJobSchema.parse(job.data);
    if (data.kind === 'dev_intro') {
      if (!devJobsEnabled() || !this.devIntro) {
        this.logger.warn(`Ignoring dev_intro job outside local development person=${data.personId}`);
        return;
      }
      // The job's creation time (stable across retries) seeds a fresh state version after the dev reset.
      const sent = await this.devIntro.send(data.tenantId, data.personId, Math.floor(job.timestamp / 1000));
      this.logger.log(`Dev intro queued person=${data.personId} trust=${sent.trustMessageId}`);
      return;
    }
    if (data.kind === 'system') {
      const at = new Date();
      const event = data.event.type === 'role_changed'
        ? { type: 'role_changed' as const, from: data.event.from, to: data.event.to, at }
        : { type: 'deactivated' as const, at };
      const result = await this.onboarding.apply(data.tenantId, data.personId, event);
      this.logger.log(`Onboarding system event=${event.type} person=${data.personId} changed=${result.changed}`);
      return;
    }
    const { tenantId, personId, action, actionTs } = data;
    const at = new Date(Number(actionTs) * 1000);
    if (Number.isNaN(at.getTime())) throw new Error(`Invalid onboarding action timestamp: ${actionTs}`);
    const result = await this.onboarding.apply(tenantId, personId, { type: 'action', action, source: 'button', at });
    this.logger.log(`Onboarding button action=${action} person=${personId} changed=${result.changed}`);
  }
}
