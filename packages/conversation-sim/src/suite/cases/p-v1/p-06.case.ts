import { contextCriterion } from './decision-context';
import { MEANING, P06_EARLIER_CONVERSATION, P06_REMEMBERED_COMMITMENT, SEND, STAGE, coach, rule, user } from './texts';

const HOUR_MS = 3_600_000;
const TIMEZONE = 'UTC';
/** Friday 2026-01-02 16:00 UTC, 64 hours before the window start. */
const EARLIER_OFFSET_MS = 64 * HOUR_MS;

/**
 * P-06 observation: seven days from Monday 2026-01-05 08:00 UTC, one UTC user with quiet hours
 * 22-08, scanned every 15 minutes. C3 checks 08:00-20:00 (Illia, 2026-10-26); the product sends
 * until 22:00, so a 20:00-22:00 send is a known red. C4-C5 need a judge (L1).
 *
 * C4 setup (Illia, 2026-10-27): an earlier conversation on Friday 2026-01-02 16:00 UTC and the
 * commitment it left in memory, so the first check-in (Monday 16:00, after 3 days of silence)
 * has an earlier conversation to continue. E3 checks both reach the model on that check-in.
 */
export const test = {
  id: 'P-06',
  sourceCase: 'P-06',
  requirement: ['CF-003'],
  kind: 'observation',
  levels: ['L0', 'L1'],
  runProfile: 'isolated',
  seed: {
    history: [
      { ...user(P06_EARLIER_CONVERSATION[0]), atOffsetMs: EARLIER_OFFSET_MS },
      { ...coach(P06_EARLIER_CONVERSATION[1]), atOffsetMs: EARLIER_OFFSET_MS - 60_000 },
    ],
  },
  setup: [
    { name: 'clock', params: { start: '2026-01-05T08:00:00Z' } },
    { name: 'memoryItems', params: { items: [{ category: 'commitment', content: P06_REMEMBERED_COMMITMENT, importance: 0.8 }] } },
    {
      name: 'proactiveUsers',
      params: {
        timezone: TIMEZONE,
        quietHours: { enabled: true, startHour: 22, endHour: 8 },
        scan: { minSilenceDays: 3, minCheckInGapDays: 2, quietHoursEnabled: true },
      },
    },
  ],
  scripted: [],
  preconditions: [],
  steps: [],
  observationWindow: { durationMs: 7 * 24 * HOUR_MS, scanEveryMs: HOUR_MS / 4 },
  criteria: [
    { id: 'P-06.C1', evaluatedAt: 'observation-window', checks: [rule('proactive-initiated')] },
    { id: 'P-06.C2', evaluatedAt: 'observation-window', checks: [rule('proactive-spacing')] },
    {
      id: 'P-06.C3',
      evaluatedAt: 'observation-window',
      checks: [rule('proactive-working-hours', { timezone: TIMEZONE, startHour: 8, endHour: 20 })],
    },
    // The judge reads the first check-in for C4 (the one that continues Friday's conversation) and every check-in for C5.
    { id: 'P-06.C4', evaluatedAt: 'observation-window', windowScope: 'first', levels: ['L1'], checks: [MEANING] },
    { id: 'P-06.C5', evaluatedAt: 'observation-window', windowScope: 'all', levels: ['L1'], checks: [MEANING] },
    {
      id: 'P-06.E1',
      evaluatedAt: 'observation-window',
      levels: ['L0'],
      checks: [{ type: 'rule', rule: 'effect-count', params: { ...STAGE, expected: 0, step: 0 } }],
    },
    // Counted as check-in sends, not total outbound: the seeded earlier conversation adds one outbound.
    { id: 'P-06.E2', evaluatedAt: 'observation-window', levels: ['L0'], checks: [{ type: 'rule', rule: 'effect-count', params: { ...SEND, expected: 4, step: 0 } }] },
    contextCriterion(
      'P-06.E3',
      { historyTurns: { min: 2 }, historyUser: { min: 1 }, memoryItems: { min: 1 }, memoryCategories: ['commitment'] },
      { step: 0, call: 'first' },
    ),
  ],
};
