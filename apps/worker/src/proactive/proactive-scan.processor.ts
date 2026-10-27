import { Processor, WorkerHost, InjectQueue } from '@nestjs/bullmq';
import { Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job, Queue } from 'bullmq';
import { ProactiveSchedulerUseCase } from '@entalent/application';
import type { Env } from '@entalent/config';
import { QUEUE_NAMES } from '../queue/queue.module';
import { OnboardingDispatchService } from '../conversation/onboarding-dispatch.service';
import { OnboardingReminderSweepService } from '../onboarding/onboarding-reminder-sweep.service';
import { OnboardingRoleReconcileService } from '../onboarding/onboarding-role-reconcile.service';

export interface ProactiveScanJob {
  /** Optional tenant filter — omitted for the scheduled repeatable scan */
  tenantId?: string;
  /** Required with onboarding-only jobs to prevent processing other Units. */
  unitId?: string;
}

const REPEATABLE_JOB_ID = 'proactive-scan-recurring';

@Processor(QUEUE_NAMES.PROACTIVE_SCAN)
export class ProactiveScanProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(ProactiveScanProcessor.name);

  constructor(
    private readonly scheduler: ProactiveSchedulerUseCase,
    @InjectQueue(QUEUE_NAMES.PROACTIVE_SCAN) private readonly queue: Queue<ProactiveScanJob>,
    private readonly config: ConfigService<Env, true>,
    private readonly onboarding: OnboardingDispatchService,
    private readonly reminderSweep: OnboardingReminderSweepService,
    private readonly roleReconcile: OnboardingRoleReconcileService,
  ) {
    super();
  }

  private scanEnabled(): boolean {
    return this.config.get('PROACTIVE_SCAN_ENABLED', { infer: true });
  }

  /** Register the recurring scan once on boot. Fixed jobId keeps it idempotent across restarts. */
  async onModuleInit(): Promise<void> {
    if (!this.scanEnabled()) {
      this.logger.log('Proactive scan disabled (PROACTIVE_SCAN_ENABLED=false)');
      return;
    }
    const intervalMin = this.config.get('PROACTIVE_SCAN_INTERVAL_MIN', { infer: true });
    await this.queue.add(
      'scan',
      {},
      {
        repeat: { every: intervalMin * 60 * 1000 },
        jobId: REPEATABLE_JOB_ID,
        removeOnComplete: true,
        removeOnFail: true,
      },
    );
    this.logger.log(`Registered repeatable proactive scan every ${intervalMin}min`);
  }

  async process(job: Job<ProactiveScanJob>): Promise<void> {
    if (job.name === 'onboarding-only') {
      if (!job.data.tenantId || !job.data.unitId) throw new Error('onboarding_scope_required');
      const onboarding = await this.onboarding.dispatchPending(job.data.tenantId, job.data.unitId);
      this.logger.log(
        `Onboarding-only job=${job.id} — queued=${onboarding.queued} failed=${onboarding.failed}`,
      );
      return;
    }
    // A stale repeatable in a reused Redis can still deliver `scan` after the toggle is turned off.
    if (!this.scanEnabled()) {
      this.logger.log(`Proactive scan job=${job.id} name=${job.name} ignored (PROACTIVE_SCAN_ENABLED=false)`);
      return;
    }
    const onboarding = await this.onboarding.dispatchPending(job.data.tenantId);
    // Recovery for lost reminder jobs must never block the proactive scan.
    try {
      const sweep = await this.reminderSweep.sweep(job.data.tenantId);
      if (sweep.found > 0) {
        this.logger.log(`Onboarding reminder sweep found=${sweep.found} enqueued=${sweep.enqueued} failed=${sweep.failed}`);
      }
    } catch (error) {
      this.logger.error(`Onboarding reminder sweep failed: ${(error as Error).message}`);
    }
    // Backstop for lost role-change events; same isolation from the scan.
    try {
      const reconcile = await this.roleReconcile.sweep(job.data.tenantId);
      if (reconcile.found > 0) {
        this.logger.log(`Onboarding role reconcile found=${reconcile.found} reconciled=${reconcile.reconciled} failed=${reconcile.failed}`);
      }
    } catch (error) {
      this.logger.error(`Onboarding role reconcile failed: ${(error as Error).message}`);
    }
    const result = await this.scheduler.scan({ tenantId: job.data.tenantId });
    this.logger.log(
      `Proactive scan job=${job.id} — onboardingQueued=${onboarding.queued} onboardingFailed=${onboarding.failed} candidates=${result.candidatesFound} enqueued=${result.enqueued} skippedQuietHours=${result.skippedQuietHours} skippedCadence=${result.skippedCadence}`,
    );
  }
}
