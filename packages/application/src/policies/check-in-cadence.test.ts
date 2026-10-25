import { describe, expect, it } from 'vitest';
import {
  checkInCadencePolicy,
  DEFAULT_QA_CADENCE,
  type CheckInCadenceConfig,
  type CheckInCadenceFacts,
} from './check-in-cadence';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const now = new Date('2026-08-02T12:00:00.000Z');
const before = (ms: number) => new Date(now.getTime() - ms);

const config: CheckInCadenceConfig = {
  minSilenceDays: 2,
  minCheckInGapDays: 3,
  qaCadence: DEFAULT_QA_CADENCE,
};

function facts(overrides: Partial<CheckInCadenceFacts> = {}): CheckInCadenceFacts {
  return {
    lastInboundAt: null,
    lastProactiveContactAt: null,
    recentProactiveCount: 0,
    hasUnansweredProactive: false,
    inQaCadenceCohort: false,
    ...overrides,
  };
}

describe('checkInCadencePolicy', () => {
  it('defaults the QA cadence to 2 h silence, 4 h gap and 3 per day', () => {
    expect(DEFAULT_QA_CADENCE).toEqual({ silenceHours: 2, gapHours: 4, maxPerDay: 3 });
  });

  describe('default cadence', () => {
    it('is eligible when last inbound and last contact are exactly at the window boundary', () => {
      const decision = checkInCadencePolicy(
        facts({ lastInboundAt: before(2 * DAY), lastProactiveContactAt: before(3 * DAY) }),
        config,
        now,
      );
      expect(decision).toEqual({ eligible: true });
    });

    it('rejects an inbound message 1 ms inside the silence window', () => {
      expect(checkInCadencePolicy(facts({ lastInboundAt: before(2 * DAY - 1) }), config, now))
        .toEqual({ eligible: false, reason: 'recent-inbound' });
    });

    it('rejects a proactive contact 1 ms inside the gap window', () => {
      expect(checkInCadencePolicy(facts({ lastProactiveContactAt: before(3 * DAY - 1) }), config, now))
        .toEqual({ eligible: false, reason: 'recent-proactive' });
    });

    it('treats a future-dated event as inside the window, like SQL occurred_at > now() - interval', () => {
      expect(checkInCadencePolicy(facts({ lastInboundAt: new Date(now.getTime() + 1) }), config, now))
        .toEqual({ eligible: false, reason: 'recent-inbound' });
    });

    it('is eligible for a user never contacted and never heard from', () => {
      expect(checkInCadencePolicy(facts(), config, now)).toEqual({ eligible: true });
    });

    it('ignores the QA daily cap and unanswered guard outside the QA cohort', () => {
      const decision = checkInCadencePolicy(
        facts({
          lastInboundAt: before(2 * DAY),
          lastProactiveContactAt: before(3 * DAY),
          recentProactiveCount: 5,
          hasUnansweredProactive: true,
        }),
        config,
        now,
      );
      expect(decision).toEqual({ eligible: true });
    });

    it('uses the configured day counts, not fixed values', () => {
      const wide = { ...config, minSilenceDays: 7 };
      expect(checkInCadencePolicy(facts({ lastInboundAt: before(7 * DAY - 1) }), wide, now))
        .toEqual({ eligible: false, reason: 'recent-inbound' });
      expect(checkInCadencePolicy(facts({ lastInboundAt: before(7 * DAY) }), wide, now))
        .toEqual({ eligible: true });
    });
  });

  describe('QA cadence cohort', () => {
    const qa = (overrides: Partial<CheckInCadenceFacts> = {}) => facts({ inQaCadenceCohort: true, ...overrides });

    it('is eligible when last inbound is exactly 2 h and last contact exactly 4 h before now', () => {
      expect(checkInCadencePolicy(
        qa({ lastInboundAt: before(2 * HOUR), lastProactiveContactAt: before(4 * HOUR) }),
        config,
        now,
      )).toEqual({ eligible: true });
    });

    it('rejects an inbound message 1 ms inside the 2 h QA silence window', () => {
      expect(checkInCadencePolicy(qa({ lastInboundAt: before(2 * HOUR - 1) }), config, now))
        .toEqual({ eligible: false, reason: 'recent-inbound' });
    });

    it('rejects a proactive contact 1 ms inside the 4 h QA gap window', () => {
      expect(checkInCadencePolicy(qa({ lastProactiveContactAt: before(4 * HOUR - 1) }), config, now))
        .toEqual({ eligible: false, reason: 'recent-proactive' });
    });

    it('rejects at the daily cap of 3 and allows 2', () => {
      expect(checkInCadencePolicy(qa({ recentProactiveCount: 3 }), config, now))
        .toEqual({ eligible: false, reason: 'qa-daily-cap' });
      expect(checkInCadencePolicy(qa({ recentProactiveCount: 2 }), config, now))
        .toEqual({ eligible: true });
    });

    it('rejects while a proactive message is unanswered', () => {
      expect(checkInCadencePolicy(qa({ hasUnansweredProactive: true }), config, now))
        .toEqual({ eligible: false, reason: 'qa-unanswered' });
    });

    it('reports recent-inbound before qa-daily-cap when both guards fail', () => {
      expect(checkInCadencePolicy(qa({ lastInboundAt: before(HOUR), recentProactiveCount: 3 }), config, now))
        .toEqual({ eligible: false, reason: 'recent-inbound' });
    });

    it('uses the QA intervals instead of the day-based cadence', () => {
      // 1 day of silence would block a default user (2 days) but satisfies QA (2 hours).
      expect(checkInCadencePolicy(qa({ lastInboundAt: before(DAY), lastProactiveContactAt: before(DAY) }), config, now))
        .toEqual({ eligible: true });
    });
  });
});
