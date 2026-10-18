import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { nextWorkingTime, reminderCopy, reminderDueAt } from '@entalent/application';
import type { OnboardingReminderJob, OnboardingReminderRecalculateJob } from '@entalent/contracts';
import { QUEUE_NAMES } from '../queue/queue.module';
import { OnboardingEffectsService } from './onboarding-effects.service';
import { OnboardingReminderRepository } from './onboarding-reminder.repository';
import { OnboardingService } from './onboarding.service';
import { stableId } from './stable-id';
import { reminderJobId } from './job-ids';

const POSTPONE_MS = 30 * 60_000;
/** A8: after this many postponements the reminder is sent regardless of recent activity. */
export const MAX_REMINDER_POSTPONEMENTS = 6;
const REMINDABLE = new Set(['undecided', 'deferred']);

type ReminderQueueJob = OnboardingReminderJob | OnboardingReminderRecalculateJob;

/** The single onboarding reminder (Q12-Q16): send, postpone, or drop a stale job; recompute after calendar changes. */
@Processor(QUEUE_NAMES.ONBOARDING_REMINDER)
export class OnboardingReminderProcessor extends WorkerHost {
  private readonly logger = new Logger(OnboardingReminderProcessor.name);

  constructor(
    private readonly repo: OnboardingReminderRepository,
    private readonly onboarding: OnboardingService,
    private readonly effects: OnboardingEffectsService,
    @InjectQueue(QUEUE_NAMES.ONBOARDING_REMINDER) private readonly queue: Queue<ReminderQueueJob>,
  ) {
    super();
  }

  async process(job: Job<ReminderQueueJob>): Promise<void> {
    if (job.name === 'recalculate') return this.recalculate((job.data as OnboardingReminderRecalculateJob).tenantId);
    if (job.name === 'remind') return this.remind(job.data as OnboardingReminderJob);
    this.logger.warn(`Unknown onboarding reminder job name=${job.name}`);
  }

  private async remind(data: OnboardingReminderJob): Promise<void> {
    const { tenantId, personId } = data;
    const dueMs = new Date(data.dueAt).getTime();
    const ctx = await this.repo.loadContext(tenantId, personId);
    // 1. Stale or rescheduled job (Q13).
    if (!ctx || ctx.reminderStatus !== 'scheduled' || ctx.reminderDueAt?.getTime() !== dueMs) return;
    // 2. Inactive user or person.
    if (ctx.userStatus !== 'active' || ctx.deletedAt || ctx.personLifecycle !== 'active') return;
    // 3. Never after refusal; never for management.
    if (!REMINDABLE.has(ctx.participation) || (ctx.track !== 'employee' && ctx.track !== 'team_lead')) return;
    if (!ctx.calendar) throw new Error('onboarding_work_calendar_missing');
    const track = ctx.track;
    const timeZone = ctx.userTimezone ?? ctx.calendar.timezone;
    const now = new Date();
    const postponeCount = data.postponeCount ?? 0;

    // 4. Do not interrupt a conversation in progress (A8).
    if (ctx.lastInboundAt && now.getTime() - ctx.lastInboundAt.getTime() < POSTPONE_MS
      && postponeCount < MAX_REMINDER_POSTPONEMENTS) {
      const runAt = nextWorkingTime(new Date(now.getTime() + POSTPONE_MS), ctx.calendar, timeZone);
      await this.requeue(ctx.stateId, data, postponeCount + 1, runAt, now);
      return;
    }
    // 5. The calendar may have changed since scheduling.
    const workAt = nextWorkingTime(now, ctx.calendar, timeZone);
    if (workAt.getTime() !== now.getTime()) {
      await this.requeue(ctx.stateId, data, postponeCount, workAt, now);
      return;
    }

    const target = await this.effects.findDeliveryTarget(tenantId, personId);
    if (!target) {
      this.logger.warn(`No active conversation for onboarding reminder person=${personId}`);
      return;
    }
    const text = reminderCopy(track);
    let messageId: string | null = null;
    // 6. Persist + state transition in one transaction; guards are re-checked under the row lock.
    const result = await this.onboarding.apply(tenantId, personId, { type: 'reminder_sent', at: now }, async (tx, row) => {
      if (row.state.reminderStatus !== 'scheduled' || row.reminderDueAt?.getTime() !== dueMs) return false;
      if (!REMINDABLE.has(row.state.participation) || row.state.track === 'management') return false;
      messageId = stableId('onb-reminder', personId, row.introActionsMessageTs ?? 'none');
      await tx.insertOutboundMessage({
        id: messageId, tenantId, conversationId: target.conversationId, userId: personId,
        text, messageType: 'onboarding_reminder', occurredAt: now,
      });
      return true;
    });
    // 7. Enqueue only after commit.
    if (result.changed && messageId) await this.effects.enqueueMessageSend({ tenantId, ...target }, messageId);
  }

  /**
   * Persists the next attempt (compare-and-set on reminder_due_at) so the stale check, the recovery sweep and
   * recalculation all see the real next run time, then enqueues the canonical job for it.
   */
  private async requeue(stateId: string, data: OnboardingReminderJob, postponeCount: number, runAt: Date, now: Date): Promise<void> {
    const moved = await this.repo.updateScheduledDue(stateId, runAt, new Date(data.dueAt));
    if (!moved) return;
    await this.queue.add('remind',
      { tenantId: data.tenantId, personId: data.personId, dueAt: runAt.toISOString(), postponeCount },
      { delay: Math.max(0, runAt.getTime() - now.getTime()), jobId: reminderJobId(data.personId, runAt.getTime()) });
  }

  /** Q16: after the company calendar changed. Only moves reminders that are already scheduled. */
  private async recalculate(tenantId: string): Promise<void> {
    const { calendar, rows } = await this.repo.listScheduled(tenantId);
    if (!calendar) return;
    const now = new Date();
    let moved = 0;
    let failed = 0;
    for (const row of rows) {
      try {
        const timeZone = row.userTimezone ?? calendar.timezone;
        let dueAt = reminderDueAt(row.reminderOriginAt, calendar, timeZone);
        if (dueAt.getTime() < now.getTime()) dueAt = nextWorkingTime(now, calendar, timeZone);
        if (dueAt.getTime() === row.reminderDueAt.getTime()) continue;
        if (!(await this.repo.updateScheduledDue(row.stateId, dueAt, row.reminderDueAt))) continue;
        await this.queue.add('remind', { tenantId, personId: row.personId, dueAt: dueAt.toISOString() }, {
          delay: Math.max(0, dueAt.getTime() - now.getTime()),
          jobId: reminderJobId(row.personId, dueAt.getTime()),
        });
        moved += 1;
      } catch (error) {
        failed += 1;
        this.logger.error(`Reminder recalculation failed person=${row.personId}: ${(error as Error).message}`);
      }
    }
    this.logger.log(`Recalculated onboarding reminders tenant=${tenantId} moved=${moved} failed=${failed}`);
  }
}
