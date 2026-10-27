import type {
  ProactiveSchedulerRepositoryPort,
  CheckInEnqueuePort,
} from '../ports/proactive-scheduler.repository.port';
import { isInQuietHours } from '../utils/quiet-hours';
import { systemClock, type ClockPort } from '../ports/clock.port';
import {
  checkInCadencePolicy,
  DEFAULT_QA_CADENCE,
  type QaCadenceConfig,
} from '../policies/check-in-cadence';

export interface ProactiveScanConfig {
  /** Days of silence since the user's last message before a check-in is considered */
  minSilenceDays: number;
  /** Minimum gap between proactive contacts for the same user */
  minCheckInGapDays: number;
  /** Max users contacted in a single scan (protects against a thundering herd) */
  batchLimit: number;
  /** Whether to apply the quiet-hours guard (dev toggle) */
  quietHoursEnabled: boolean;
  /**
   * Accelerated cadence for users in the tenant's QA three-per-day cohort.
   * The worker repository's SQL prefilter hardcodes the default QA intervals
   * (2 h silence, 4 h gap, fewer than 3 per 24 h), so in production an override
   * can only tighten selection; a looser value has no effect.
   */
  qaCadence: QaCadenceConfig;
}

const DEFAULT_CONFIG: ProactiveScanConfig = {
  minSilenceDays: 3,
  minCheckInGapDays: 3,
  batchLimit: 50,
  quietHoursEnabled: true,
  qaCadence: DEFAULT_QA_CADENCE,
};

export interface ProactiveScanResult {
  candidatesFound: number;
  enqueued: number;
  skippedQuietHours: number;
  /** Candidates rejected by `checkInCadencePolicy` */
  skippedCadence: number;
}

/**
 * Periodic scan that decides WHO should receive an agent-initiated check-in.
 * The repository does the heavy filtering (silence, cadence, active risk) in SQL and
 * returns per-user cadence facts; this use case re-decides cadence with the pure
 * `checkInCadencePolicy`, then applies the per-user quiet-hours guard (which needs
 * timezone math) and enqueues a check-in job for each eligible user. Users skipped
 * for cadence or quiet hours are simply picked up on a later scan.
 */
export class ProactiveSchedulerUseCase {
  private readonly config: ProactiveScanConfig;

  constructor(
    private readonly repo: ProactiveSchedulerRepositoryPort,
    private readonly queue: CheckInEnqueuePort,
    config?: Partial<ProactiveScanConfig>,
    private readonly clock: ClockPort = systemClock,
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async scan(params?: { tenantId?: string }): Promise<ProactiveScanResult> {
    // One scan instant for every candidate's cadence, quiet-hours and traceId decisions.
    const now = this.clock.now();
    const candidates = await this.repo.findCheckInCandidates({
      minSilenceDays: this.config.minSilenceDays,
      minCheckInGapDays: this.config.minCheckInGapDays,
      limit: this.config.batchLimit,
      tenantId: params?.tenantId,
    });

    let enqueued = 0;
    let skippedQuietHours = 0;
    let skippedCadence = 0;

    for (const c of candidates) {
      const cadence = checkInCadencePolicy(c.cadence, this.config, now);
      if (!cadence.eligible) {
        skippedCadence++;
        continue;
      }

      if (this.config.quietHoursEnabled && isInQuietHours(now, c.timezone, c.quietHours)) {
        skippedQuietHours++;
        continue;
      }

      await this.queue.enqueueCheckIn({
        conversationId: c.conversationId,
        userId: c.userId,
        tenantId: c.tenantId,
        externalWorkspaceId: c.externalWorkspaceId,
        externalConversationId: c.externalConversationId,
        traceId: `checkin-${c.userId}-${now.getTime()}`,
      });
      enqueued++;
    }

    return {
      candidatesFound: candidates.length,
      enqueued,
      skippedQuietHours,
      skippedCadence,
    };
  }
}
