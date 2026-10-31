import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger, OnApplicationBootstrap, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Job, Queue } from 'bullmq';
import {
  PULSE_REPORT_LIFECYCLE_QUEUE_NAME,
  PulseLifecycleJobSchema,
  type PulseLifecycleJob,
} from '@entalent/contracts';
import type { FormPulseReportUseCase, PulseReportActivationHoldReason } from '@entalent/application';
import type { Env } from '@entalent/config';
import type { PulseLifecycleQueue } from './pulse-report-lifecycle.scheduler';
import { PulseReportDeliveryService } from './pulse-report-delivery.service';
import { PulseReportLifecycleRepository } from './repositories/pulse-report-lifecycle.repository';
import { PulseReportActivationRepository } from './repositories/pulse-report-activation.repository';

export const PULSE_REPORT_SCAN_SCHEDULER_ID = 'pulse-report-lifecycle-scan';
export const PULSE_REPORT_SCAN_JOB_NAME = 'scan';
const SCHEDULER_REMOVAL_TIMEOUT_MS = 5_000;

export type PulseLifecycleProcessResult =
  | { status: 'invalid_job' }
  | { status: 'held'; holdReason: PulseReportActivationHoldReason | null; fence?: string }
  | { status: string };
export interface PulseLifecycleScanResult {
  status: 'observed';
  observed: number;
  queued: number;
  held: number;
}

/**
 * RPT-10 production driver. The activation repository is a mandatory constructor argument: discovery and
 * formation-phase repair contain only activated scopes, held deliveries are fenced but never enqueued, and every
 * job re-reads the control before formation or send.
 */
export class PulseReportLifecycleProductionDriver {
  constructor(
    private readonly lifecycle: PulseReportLifecycleRepository,
    private readonly activation: PulseReportActivationRepository,
    private readonly form: Pick<FormPulseReportUseCase, 'execute'>,
    private readonly delivery: Pick<PulseReportDeliveryService, 'deliverNext' | 'fence'>,
    private readonly queue: PulseLifecycleQueue,
    private readonly scanLimit = 25,
  ) {
    if (!activation || typeof activation.decide !== 'function' || !activation.scopeFilter)
      throw new Error('pulse_report_activation_gate_required');
  }

  async scan(): Promise<PulseLifecycleScanResult> {
    const filter = this.activation.scopeFilter;
    let observed = 0,
      queued = 0,
      held = 0;
    for (const request of await this.lifecycle.discover(this.scanLimit, filter)) {
      try {
        await this.lifecycle.observe(request);
        observed++;
      } catch {
        /* One blocked scope must not starve the fair DB cursor. */
      }
    }
    for (const row of await this.lifecycle.repair(this.scanLimit, filter)) {
      const data: PulseLifecycleJob = {
        tenantId: String(row.tenant_id),
        obligationId: String(row.obligation_id),
        action: row.snapshot_id ? 'deliver' : 'form',
      };
      try {
        if (data.action === 'deliver') {
          const { decision, snapshotId } = await this.activation.decide(data.tenantId, data.obligationId);
          if (!decision.deliver) {
            // Held: no job churn and no scheduling-field change; RPT-07 fences still cancel or escalate.
            held++;
            if (snapshotId) await this.delivery.fence(data.tenantId, snapshotId);
            continue;
          }
        }
        await this.queue.add(data.action, data, {
          jobId: 'pulse-' + data.action + '-' + data.obligationId,
          removeOnComplete: true,
          removeOnFail: true,
          attempts: 1,
        });
        queued++;
      } catch {
        /* Durable state survives enqueue/Redis loss; next DB repair observes it. */
      }
    }
    return { status: 'observed', observed, queued, held };
  }

  async process(input: unknown): Promise<PulseLifecycleProcessResult> {
    const parsed = PulseLifecycleJobSchema.safeParse(input);
    if (!parsed.success) return { status: 'invalid_job' };
    const job: PulseLifecycleJob = parsed.data;
    const { decision, snapshotId } = await this.activation.decide(job.tenantId, job.obligationId);
    if (job.action === 'form') {
      if (!decision.observe) return { status: 'held', holdReason: decision.holdReason };
      return this.form.execute(job.tenantId, job.obligationId);
    }
    if (!snapshotId) return { status: 'held', holdReason: decision.holdReason ?? 'snapshot_missing' };
    if (!decision.deliver) {
      const fence = await this.delivery.fence(job.tenantId, snapshotId);
      return { status: 'held', holdReason: decision.holdReason, fence: fence.status };
    }
    const result = await this.delivery.deliverNext(
      job.tenantId,
      snapshotId,
      this.activation.deliveryGuard(job.tenantId, job.obligationId),
    );
    if (result.status !== 'held') return result;
    return { status: 'held', holdReason: (await this.activation.decide(job.tenantId, job.obligationId)).decision.holdReason };
  }
}

/**
 * Registered queue consumer. `PULSE_REPORTS_ENABLED` is the process kill switch (the BullMQ worker only runs when
 * enabled); DB activation controls are the second lock.
 */
@Processor(PULSE_REPORT_LIFECYCLE_QUEUE_NAME, { autorun: false })
export class PulseReportLifecycleWorker extends WorkerHost implements OnModuleInit, OnApplicationBootstrap {
  private readonly logger = new Logger(PulseReportLifecycleWorker.name);

  constructor(
    @InjectQueue(PULSE_REPORT_LIFECYCLE_QUEUE_NAME) private readonly queue: Queue,
    @Inject(ConfigService) private readonly config: ConfigService<Env, true>,
    @Inject(PulseReportLifecycleProductionDriver)
    private readonly driver: PulseReportLifecycleProductionDriver,
  ) {
    super();
  }

  private get enabled(): boolean {
    return this.config.get('PULSE_REPORTS_ENABLED', { infer: true }) === true;
  }

  async onModuleInit(): Promise<void> {
    if (!this.enabled) {
      // A previous enabled boot may have left the scheduler in Redis. Bounded so Redis loss cannot block boot.
      let timer: NodeJS.Timeout | undefined;
      const removal = this.queue.removeJobScheduler(PULSE_REPORT_SCAN_SCHEDULER_ID);
      const timeout = new Promise<'timeout'>((resolve) => {
        timer = setTimeout(() => resolve('timeout'), SCHEDULER_REMOVAL_TIMEOUT_MS);
      });
      try {
        const removed = await Promise.race([removal, timeout]);
        if (removed === 'timeout') {
          removal.catch(() => undefined);
          this.logger.warn('Pulse report lifecycle disabled; scan scheduler removal timed out');
        } else this.logger.log(`Pulse report lifecycle disabled; scan scheduler removed=${removed}`);
      } catch (error) {
        this.logger.warn(`Pulse report lifecycle disabled; scan scheduler removal failed: ${(error as Error).message}`);
      } finally {
        clearTimeout(timer);
      }
      return;
    }
    const seconds = this.config.get('PULSE_REPORT_SCAN_INTERVAL_SEC', { infer: true });
    await this.queue.upsertJobScheduler(
      PULSE_REPORT_SCAN_SCHEDULER_ID,
      { every: seconds * 1000 },
      { name: PULSE_REPORT_SCAN_JOB_NAME, data: {}, opts: { removeOnComplete: true, removeOnFail: true } },
    );
    this.logger.log(`Pulse report lifecycle scan registered every ${seconds}s (DB activation controls apply)`);
  }

  /** Workers are created by the BullMQ explorer during init with autorun=false; start consuming only when enabled. */
  onApplicationBootstrap(): void {
    if (!this.enabled) return;
    this.worker.run().catch((error: unknown) =>
      this.logger.error(`Pulse report lifecycle worker stopped: ${(error as Error).message}`),
    );
  }

  async process(job: Job): Promise<PulseLifecycleProcessResult | PulseLifecycleScanResult | { status: 'disabled' }> {
    if (!this.enabled) return { status: 'disabled' };
    if (job.name === PULSE_REPORT_SCAN_JOB_NAME) {
      const result = await this.driver.scan();
      if (result.observed || result.queued || result.held)
        this.logger.log(`Pulse report scan observed=${result.observed} queued=${result.queued} held=${result.held}`);
      return result;
    }
    const result = await this.driver.process(job.data);
    const holdReason = 'holdReason' in result ? result.holdReason : null;
    const data = job.data as { action?: string; obligationId?: string } | undefined;
    this.logger.log(
      `Pulse report ${String(data?.action)} obligation=${String(data?.obligationId)} status=${result.status}${holdReason ? ` hold=${holdReason}` : ''}`,
    );
    return result;
  }
}
