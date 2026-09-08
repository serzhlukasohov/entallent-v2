import type { RetentionCleanupRepositoryPort, RetentionCleanupResult } from '../ports/retention.repository.port';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface RetentionCleanupInput {
  now: Date;
}

export interface RetentionCleanupUseCaseResult extends RetentionCleanupResult {
  tenantsProcessed: number;
}

const EMPTY_RESULT: RetentionCleanupUseCaseResult = {
  tenantsProcessed: 0,
  messagesDeleted: 0,
  surveyEvidenceExpired: 0,
  memoryItemsExpired: 0,
  riskSignalsExpired: 0,
  temporaryGroupStatesExpired: 0,
  confirmedGroupStatesExpired: 0,
  withdrawnGroupStatesExpired: 0,
  auditLogsDeleted: 0,
  reportSnapshotsDeleted: 0,
};

export class RetentionCleanupUseCase {
  constructor(private readonly repo: RetentionCleanupRepositoryPort) {}

  async execute(input: RetentionCleanupInput): Promise<RetentionCleanupUseCaseResult> {
    if (!Number.isFinite(input.now.getTime())) {
      throw new Error('retention_cleanup_now_invalid');
    }

    const totals = { ...EMPTY_RESULT };
    const tenants = await this.repo.findRetentionTenants();
    for (const tenant of tenants) {
      const result = await this.repo.applyRetention({
        tenantId: tenant.tenantId,
        now: input.now,
        messagesCutoff: cutoff(input.now, tenant.retentionPolicy.messagesRetentionDays),
        memoryCutoff: cutoff(input.now, tenant.retentionPolicy.memoryRetentionDays),
        riskSignalCutoff: cutoff(input.now, tenant.retentionPolicy.riskSignalRetentionDays),
        auditLogCutoff: cutoff(input.now, tenant.retentionPolicy.auditLogRetentionDays),
      });
      totals.tenantsProcessed += 1;
      addResult(totals, result);
    }
    return totals;
  }
}

function cutoff(now: Date, days: number): Date {
  return new Date(now.getTime() - days * DAY_MS);
}

function addResult(target: RetentionCleanupUseCaseResult, result: RetentionCleanupResult): void {
  target.messagesDeleted += result.messagesDeleted;
  target.surveyEvidenceExpired += result.surveyEvidenceExpired;
  target.memoryItemsExpired += result.memoryItemsExpired;
  target.riskSignalsExpired += result.riskSignalsExpired;
  target.temporaryGroupStatesExpired += result.temporaryGroupStatesExpired;
  target.confirmedGroupStatesExpired += result.confirmedGroupStatesExpired;
  target.withdrawnGroupStatesExpired += result.withdrawnGroupStatesExpired;
  target.auditLogsDeleted += result.auditLogsDeleted;
  target.reportSnapshotsDeleted += result.reportSnapshotsDeleted;
}
