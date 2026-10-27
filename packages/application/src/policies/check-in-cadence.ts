/**
 * Pure proactive check-in cadence policy (Story 12.6).
 *
 * Mirrors every branch of the cadence predicate in the worker's
 * `ProactiveSchedulerRepository` SQL. The repository keeps that SQL as a
 * prefilter and also returns these per-user facts; the scheduler use case then
 * re-decides with this policy so the rule is testable without a database.
 *
 * Boundaries follow SQL `occurred_at > now() - interval`: an event exactly
 * `interval` before `now` no longer blocks.
 */

export interface CheckInCadenceFacts {
  /** Latest inbound message, excluding the `__init__` bootstrap message. */
  lastInboundAt: Date | null;
  /**
   * Latest proactive contact: outbound `proactive_check_in`, `proactive_follow_up`,
   * `reminder`, or inbound system `proactive_check_in_request`.
   */
  lastProactiveContactAt: Date | null;
  /** Outbound proactive messages in the window `(now - 24h, now]`. */
  recentProactiveCount: number;
  /** An outbound proactive message exists with no later inbound (non-`__init__`) reply. */
  hasUnansweredProactive: boolean;
  /** Member of the tenant's active `qaThreePerDayCohortId` cohort roster. */
  inQaCadenceCohort: boolean;
}

export interface QaCadenceConfig {
  silenceHours: number;
  gapHours: number;
  maxPerDay: number;
}

export const DEFAULT_QA_CADENCE: QaCadenceConfig = {
  silenceHours: 2,
  gapHours: 4,
  maxPerDay: 3,
};

export interface CheckInCadenceConfig {
  minSilenceDays: number;
  minCheckInGapDays: number;
  qaCadence: QaCadenceConfig;
}

export type CheckInCadenceIneligibleReason =
  | 'recent-inbound'
  | 'recent-proactive'
  | 'qa-daily-cap'
  | 'qa-unanswered';

export type CheckInCadenceDecision =
  | { eligible: true }
  | { eligible: false; reason: CheckInCadenceIneligibleReason };

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

function isWithin(at: Date | null, windowMs: number, now: Date): boolean {
  return at !== null && at.getTime() > now.getTime() - windowMs;
}

export function checkInCadencePolicy(
  facts: CheckInCadenceFacts,
  config: CheckInCadenceConfig,
  now: Date,
): CheckInCadenceDecision {
  const qa = facts.inQaCadenceCohort;
  const silenceMs = qa ? config.qaCadence.silenceHours * HOUR_MS : config.minSilenceDays * DAY_MS;
  const gapMs = qa ? config.qaCadence.gapHours * HOUR_MS : config.minCheckInGapDays * DAY_MS;

  if (isWithin(facts.lastInboundAt, silenceMs, now)) {
    return { eligible: false, reason: 'recent-inbound' };
  }
  if (isWithin(facts.lastProactiveContactAt, gapMs, now)) {
    return { eligible: false, reason: 'recent-proactive' };
  }
  if (qa) {
    if (facts.recentProactiveCount >= config.qaCadence.maxPerDay) {
      return { eligible: false, reason: 'qa-daily-cap' };
    }
    if (facts.hasUnansweredProactive) {
      return { eligible: false, reason: 'qa-unanswered' };
    }
  }
  return { eligible: true };
}
