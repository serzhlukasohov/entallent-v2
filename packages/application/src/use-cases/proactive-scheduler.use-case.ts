import type {
  ProactiveSchedulerRepositoryPort,
  CheckInEnqueuePort,
} from '../ports/proactive-scheduler.repository.port';
import { isInQuietHours } from '../utils/quiet-hours';

export interface ProactiveScanConfig {
  /** Days of silence since the user's last message before a check-in is considered */
  minSilenceDays: number;
  /** Minimum gap between proactive contacts for the same user */
  minCheckInGapDays: number;
  /** Max users contacted in a single scan (protects against a thundering herd) */
  batchLimit: number;
}

const DEFAULT_CONFIG: ProactiveScanConfig = {
  minSilenceDays: 3,
  minCheckInGapDays: 5,
  batchLimit: 50,
};

export interface ProactiveScanResult {
  candidatesFound: number;
  enqueued: number;
  skippedQuietHours: number;
}

/**
 * Periodic scan that decides WHO should receive an agent-initiated check-in.
 * The repository does the heavy filtering (silence, cadence, active risk) in SQL;
 * this use case applies the per-user quiet-hours guard (which needs timezone math)
 * and enqueues a check-in job for each eligible user. Users skipped for quiet hours
 * are simply picked up on the next scan.
 */
export class ProactiveSchedulerUseCase {
  private readonly config: ProactiveScanConfig;

  constructor(
    private readonly repo: ProactiveSchedulerRepositoryPort,
    private readonly queue: CheckInEnqueuePort,
    config?: Partial<ProactiveScanConfig>,
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async scan(params?: { tenantId?: string }): Promise<ProactiveScanResult> {
    const candidates = await this.repo.findCheckInCandidates({
      minSilenceDays: this.config.minSilenceDays,
      minCheckInGapDays: this.config.minCheckInGapDays,
      limit: this.config.batchLimit,
      tenantId: params?.tenantId,
    });

    let enqueued = 0;
    let skippedQuietHours = 0;

    for (const c of candidates) {
      if (isInQuietHours(c.timezone, c.quietHours)) {
        skippedQuietHours++;
        continue;
      }

      await this.queue.enqueueCheckIn({
        conversationId: c.conversationId,
        userId: c.userId,
        tenantId: c.tenantId,
        externalWorkspaceId: c.externalWorkspaceId,
        externalConversationId: c.externalConversationId,
        traceId: `checkin-${c.userId}-${Date.now()}`,
      });
      enqueued++;
    }

    return {
      candidatesFound: candidates.length,
      enqueued,
      skippedQuietHours,
    };
  }
}
