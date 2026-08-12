import { describe, expect, expectTypeOf, it } from 'vitest';
import type {
  AdminEngagementPoint,
  AdminManagerTrendsResponse,
  AdminQuestionSentiment,
  AdminSignalPoint,
} from './admin-manager-trends';

describe('admin manager trends contract', () => {
  it('preserves the trends response envelope', () => {
    const response = {
      rangeStart: '2026-08-01',
      rangeEnd: '2026-08-14',
      engagement: [
        {
          date: '2026-08-01',
          activeUsers: 2,
          inboundMessages: 5,
        },
      ],
      signalCapture: [
        {
          date: '2026-08-01',
          total: 3,
          positive: 1,
          negative: 1,
          mixed: 1,
          neutral: 0,
        },
      ],
      coverageFunnel: {
        unknown: 1,
        scored: 2,
      },
      questionSentiment: [
        {
          stableKey: 'engagement_current',
          title: 'Current Engagement',
          dimension: 'engagement',
          positive: 0,
          negative: 0,
          mixed: 0,
          neutral: 0,
          total: 0,
          net: null,
        },
      ],
    } satisfies AdminManagerTrendsResponse;

    expect(response.questionSentiment[0]?.net).toBeNull();
    expect(response.signalCapture[0]?.total).toBe(3);
    expectTypeOf(response).toMatchTypeOf<AdminManagerTrendsResponse>();
  });

  it('keeps dashboard-critical field types stable', () => {
    expectTypeOf<AdminEngagementPoint['date']>().toEqualTypeOf<string>();
    expectTypeOf<AdminEngagementPoint['activeUsers']>().toEqualTypeOf<number>();
    expectTypeOf<AdminSignalPoint['mixed']>().toEqualTypeOf<number>();
    expectTypeOf<AdminQuestionSentiment['net']>().toEqualTypeOf<number | null>();
    expectTypeOf<AdminManagerTrendsResponse['coverageFunnel']>().toEqualTypeOf<
      Record<string, number>
    >();
  });
});
