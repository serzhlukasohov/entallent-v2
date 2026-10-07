import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { QUEUE_NAMES, type OnboardingReminderRecalculateJob } from '@entalent/contracts';
import type { OnboardingReminderRecalculator } from './company-calendar.service';

/** Hands the recomputation to the worker, which owns reminder state and jobs. */
@Injectable()
export class BullOnboardingReminderRecalculator implements OnboardingReminderRecalculator {
  constructor(
    @InjectQueue(QUEUE_NAMES.ONBOARDING_REMINDER) private readonly queue: Queue<OnboardingReminderRecalculateJob>,
  ) {}

  async recalculateScheduledReminders(tenantId: string): Promise<void> {
    await this.queue.add('recalculate', { tenantId }, { jobId: `onb-recalc:${tenantId}:${Date.now()}` });
  }
}
