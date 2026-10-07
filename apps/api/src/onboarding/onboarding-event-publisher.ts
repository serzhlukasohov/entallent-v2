import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { QUEUE_NAMES, type OnboardingActionJob, type OnboardingSystemJob } from '@entalent/contracts';

export interface OnboardingSystemEvent {
  personId: string;
  /** The audit row of the hierarchy mutation; keeps the job id unique and replay-safe. */
  auditLogId: string;
  event: OnboardingSystemJob['event'];
}

/**
 * Hands committed hierarchy changes (role change, deactivation) to the worker's onboarding state machine.
 * Best effort: a failure is logged and never reaches the caller; the worker's reconcile sweep is the backstop.
 */
@Injectable()
export class OnboardingEventPublisher {
  private readonly logger = new Logger(OnboardingEventPublisher.name);

  constructor(
    @InjectQueue(QUEUE_NAMES.ONBOARDING_ACTION) private readonly queue: Queue<OnboardingActionJob | OnboardingSystemJob>,
  ) {}

  async publish(tenantId: string, events: OnboardingSystemEvent[]): Promise<void> {
    for (const { personId, auditLogId, event } of events) {
      try {
        await this.queue.add('system', { kind: 'system', tenantId, personId, event }, {
          jobId: `onb-sys:${personId}:${auditLogId}`,
        });
      } catch (error) {
        this.logger.error(`Onboarding system event enqueue failed person=${personId}: ${(error as Error).message}`);
      }
    }
  }
}
