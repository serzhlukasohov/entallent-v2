import type { PulseLifecycleJob } from '@entalent/contracts';
import type { PulseReportLifecycleRepository } from './repositories/pulse-report-lifecycle.repository';
export interface PulseLifecycleQueue {
  add(
    name: string,
    data: PulseLifecycleJob,
    options: { jobId: string; removeOnComplete: boolean; removeOnFail: boolean; attempts: number },
  ): Promise<unknown>;
}
export type PulseLifecycleScanSource = Pick<PulseReportLifecycleRepository, 'discover' | 'observe' | 'repair'>;
/** No module-load timer, cron decorator, queue or provider effect. Production registration (RPT-10) wraps it in PulseReportLifecycleProductionDriver. */
export class PulseReportLifecycleScheduler {
  constructor(
    private readonly repository: PulseLifecycleScanSource,
    private readonly queue: PulseLifecycleQueue,
    private readonly enabled = false,
  ) {}
  async runOnce(limit = 25) {
    if (!this.enabled) return { status: 'disabled', observed: 0, queued: 0 };
    let observed = 0,
      queued = 0;
    for (const request of await this.repository.discover(limit)) {
      try {
        await this.repository.observe(request);
        observed++;
      } catch {
        /* One blocked scope must not starve the fair DB cursor. */
      }
    }
    for (const row of await this.repository.repair(limit)) {
      const data: PulseLifecycleJob = {
        tenantId: String(row.tenant_id),
        obligationId: String(row.obligation_id),
        action: row.snapshot_id ? 'deliver' : 'form',
      };
      try {
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
    return { status: 'observed', observed, queued };
  }
}
