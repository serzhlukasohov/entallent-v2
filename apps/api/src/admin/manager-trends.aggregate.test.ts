import { describe, it, expect } from 'vitest';
import { buildTrends, dateRange, type BuildTrendsInput } from './manager-trends.aggregate';

function base(overrides: Partial<BuildTrendsInput> = {}): BuildTrendsInput {
  return {
    rangeEnd: '2026-07-18',
    days: 3,
    engagement: [],
    signals: [],
    funnel: [],
    questions: [],
    ...overrides,
  };
}

describe('dateRange', () => {
  it('produces inclusive continuous days ending at rangeEnd', () => {
    expect(dateRange('2026-07-18', 3)).toEqual(['2026-07-16', '2026-07-17', '2026-07-18']);
  });

  it('handles month boundaries', () => {
    expect(dateRange('2026-08-01', 2)).toEqual(['2026-07-31', '2026-08-01']);
  });
});

describe('buildTrends', () => {
  it('fills engagement gaps with zeros', () => {
    const r = buildTrends(
      base({ engagement: [{ day: '2026-07-17', activeUsers: 5, inboundMessages: 20 }] }),
    );
    expect(r.engagement).toEqual([
      { date: '2026-07-16', activeUsers: 0, inboundMessages: 0 },
      { date: '2026-07-17', activeUsers: 5, inboundMessages: 20 },
      { date: '2026-07-18', activeUsers: 0, inboundMessages: 0 },
    ]);
  });

  it('buckets signal polarity per day and totals them', () => {
    const r = buildTrends(
      base({
        signals: [
          { day: '2026-07-17', polarity: 'negative', count: 3 },
          { day: '2026-07-17', polarity: 'positive', count: 1 },
          { day: '2026-07-18', polarity: 'mixed', count: 2 },
        ],
      }),
    );
    const d17 = r.signalCapture.find((s) => s.date === '2026-07-17')!;
    expect(d17).toMatchObject({ negative: 3, positive: 1, total: 4 });
    const d18 = r.signalCapture.find((s) => s.date === '2026-07-18')!;
    expect(d18).toMatchObject({ mixed: 2, total: 2 });
    // gap day is all zeros
    expect(r.signalCapture.find((s) => s.date === '2026-07-16')!.total).toBe(0);
  });

  it('ignores signals outside the window', () => {
    const r = buildTrends(base({ signals: [{ day: '2026-01-01', polarity: 'positive', count: 9 }] }));
    expect(r.signalCapture.every((s) => s.total === 0)).toBe(true);
  });

  it('fills all funnel statuses even when absent', () => {
    const r = buildTrends(base({ funnel: [{ status: 'scored', count: 4 }] }));
    expect(r.coverageFunnel).toMatchObject({ scored: 4, unknown: 0, insufficient_evidence: 0, partially_covered: 0 });
  });

  it('computes per-question net sentiment and sorts most-negative first', () => {
    const r = buildTrends(
      base({
        questions: [
          { stableKey: 'q_good', title: 'Good', dimension: 'd', polarity: 'positive', count: 8 },
          { stableKey: 'q_good', title: 'Good', dimension: 'd', polarity: 'negative', count: 2 },
          { stableKey: 'q_bad', title: 'Bad', dimension: 'd', polarity: 'negative', count: 9 },
          { stableKey: 'q_bad', title: 'Bad', dimension: 'd', polarity: 'positive', count: 1 },
        ],
      }),
    );
    // q_bad net = (1-9)/10 = -0.8, q_good net = (8-2)/10 = 0.6 → bad first
    expect(r.questionSentiment.map((q) => q.stableKey)).toEqual(['q_bad', 'q_good']);
    expect(r.questionSentiment[0].net).toBe(-0.8);
    expect(r.questionSentiment[1].net).toBe(0.6);
  });

  it('reports null net for questions with no evidence', () => {
    const r = buildTrends(
      base({ questions: [{ stableKey: 'q1', title: 'Q', dimension: 'd', polarity: 'unknown', count: 0 }] }),
    );
    expect(r.questionSentiment[0].net).toBeNull();
  });

  it('sets rangeStart/rangeEnd from the window', () => {
    const r = buildTrends(base({ days: 3, rangeEnd: '2026-07-18' }));
    expect(r.rangeStart).toBe('2026-07-16');
    expect(r.rangeEnd).toBe('2026-07-18');
  });
});
