import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { and, eq, lte, sql } from 'drizzle-orm';
import type { OnboardingReminderJob } from '@entalent/contracts';
import { onboardingStates } from '@entalent/database';
import { DatabaseService } from '../database/database.service';
import { QUEUE_NAMES } from '../queue/queue.module';

const SWEEP_LIMIT = 100;

/**
 * Recovery for reminders whose delayed job was lost (Redis flush, crash between commit and enqueue).
 * Uses an hour-bucketed id so a retained completed canonical job cannot swallow it; the processor's stale
 * check, the row lock and the deterministic message id keep duplicate runs harmless.
 */
@Injectable()
export class OnboardingReminderSweepService {
  private readonly logger = new Logger(OnboardingReminderSweepService.name);

  constructor(
    @InjectQueue(QUEUE_NAMES.ONBOARDING_REMINDER) private readonly queue: Queue<OnboardingReminderJob>,
    private readonly db: DatabaseService,
  ) {}

  async sweep(tenantId?: string): Promise<{ found: number; enqueued: number; failed: number }> {
    const rows = await this.db.client.select({
      tenantId: onboardingStates.tenantId, personId: onboardingStates.personId, reminderDueAt: onboardingStates.reminderDueAt,
    }).from(onboardingStates).where(and(
      eq(onboardingStates.reminderStatus, 'scheduled'),
      lte(onboardingStates.reminderDueAt, sql`now() - interval '5 minutes'`),
      ...(tenantId ? [eq(onboardingStates.tenantId, tenantId)] : []),
    )).limit(SWEEP_LIMIT);
    let enqueued = 0;
    let failed = 0;
    for (const row of rows) {
      try {
        if (!row.reminderDueAt) continue;
        await this.queue.add('remind', {
          tenantId: row.tenantId, personId: row.personId, dueAt: row.reminderDueAt.toISOString(),
        }, {
          delay: 0,
          // Distinct from the canonical id: a retained completed job must not dedupe the recovery (max one per row per hour).
          jobId: `onb-rem:${row.personId}:${row.reminderDueAt.getTime()}:sweep:${Math.floor(Date.now() / 3_600_000)}`,
        });
        enqueued += 1;
      } catch (error) {
        failed += 1;
        this.logger.error(`Reminder sweep failed person=${row.personId}: ${(error as Error).message}`);
      }
    }
    return { found: rows.length, enqueued, failed };
  }
}
