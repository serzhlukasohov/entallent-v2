import type { PulseReportLifecycleRepositoryPort } from '../ports/pulse-report-lifecycle.repository.port';
import type { BuildPulseReportUseCase } from './build-pulse-report.use-case';
import type { PulseAssemblyLease, BuildPulseReportResult } from '@entalent/contracts';
export class FormPulseReportUseCase {
  constructor(
    private readonly lifecycle: PulseReportLifecycleRepositoryPort,
    private readonly builder: BuildPulseReportUseCase,
    private readonly snapshots: {
      freeze(
        lease: PulseAssemblyLease,
        built: Extract<BuildPulseReportResult, { status: 'built' }>,
      ): Promise<{ status: string; snapshotId?: string }>;
    },
  ) {}
  async execute(tenantId: string, obligationId: string) {
    let lease = await this.lifecycle.claim(tenantId, obligationId);
    if (!lease) return { status: 'not_claimed' };
    let lost = false,
      stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let renewing: Promise<void> | undefined;
    const deadline = Date.now() + 30 * 60 * 1000;
    const schedule = () => {
      if (!this.lifecycle.renew || stopped || lost) return;
      timer = setTimeout(() => {
        renewing = (async () => {
          const owner = lease!;
          try {
            const renewed = await this.lifecycle.renew!(owner);
            lost = Date.now() >= deadline || (!renewed && lease!.token === owner.token);
          } catch {
            lost = true;
          }
          if (!stopped && !lost) schedule();
        })();
      }, this.lifecycle.renewalIntervalMs ?? 20000);
    };
    schedule();
    try {
      let built = await this.builder.executeInitiated(tenantId, obligationId, lease.token);
      if (lost || !(await this.lifecycle.load(tenantId, obligationId, lease.token))) {
        await this.lifecycle.defer(lease, 'lease_lost');
        return { status: 'lease_lost' };
      }
      if (built.status === 'invalidated' && this.lifecycle.rebaseHistory) {
        const rebased = await this.lifecycle.rebaseHistory(lease);
        if (rebased) {
          lease = rebased;
          built = await this.builder.executeInitiated(tenantId, obligationId, lease.token);
        }
      }
      if (lost || !(await this.lifecycle.load(tenantId, obligationId, lease.token))) {
        await this.lifecycle.defer(lease, 'lease_lost');
        return { status: 'lease_lost' };
      }
      if (built.status !== 'built') {
        await this.lifecycle.defer(lease, built.status);
        return built;
      }
      try {
        const frozen = await this.snapshots.freeze(lease, built);
        if (frozen.status !== 'snapshot_ready')
          await this.lifecycle.defer(
            lease,
            frozen.status === 'invalidated' ? 'pending' : frozen.status,
          );
        return frozen;
      } catch {
        await this.lifecycle.defer(lease, 'snapshot_commit_blocked');
        return { status: 'blocked' };
      }
    } finally {
      stopped = true;
      if (timer) clearTimeout(timer);
      await renewing;
    }
  }
}
