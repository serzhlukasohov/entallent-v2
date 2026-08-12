import { describe, expect, expectTypeOf, it } from 'vitest';
import type { AdminQuestionInsight, AdminUserInsightsResponse } from './admin-user-insights';

describe('admin user insights contract', () => {
  it('preserves the empty active-window response envelope', () => {
    const response = {
      userId: 'user-1',
      windowId: null,
      periodEnd: null,
      questions: [],
    } satisfies AdminUserInsightsResponse;

    expect(response.windowId).toBeNull();
    expect(response.periodEnd).toBeNull();
    expect(response.questions).toEqual([]);
    expectTypeOf(response).toMatchTypeOf<AdminUserInsightsResponse>();
  });

  it('preserves nullable assessment and evidence fields', () => {
    const insight = {
      questionId: 'question-1',
      stableKey: 'engagement_current',
      title: 'Current Engagement',
      canonicalMeaning: 'How engaged the employee feels now',
      group: 'engagement',
      displayOrder: 1,
      assessmentStatus: null,
      score: null,
      assessmentConfidence: null,
      currentState: null,
      assessedAt: null,
      polarity: null,
      evidenceStrength: null,
      rootCause: null,
      evidenceUpdatedAt: null,
    } satisfies AdminQuestionInsight;

    expect(insight.assessmentStatus).toBeNull();
    expect(insight.score).toBeNull();
    expect(insight.rootCause).toBeNull();
    expectTypeOf(insight).toMatchTypeOf<AdminQuestionInsight>();
  });

  it('keeps dashboard-critical field types stable', () => {
    expectTypeOf<AdminQuestionInsight['displayOrder']>().toEqualTypeOf<number>();
    expectTypeOf<AdminQuestionInsight['score']>().toEqualTypeOf<number | null>();
    expectTypeOf<AdminQuestionInsight['assessmentConfidence']>().toEqualTypeOf<number | null>();
    expectTypeOf<AdminQuestionInsight['evidenceStrength']>().toEqualTypeOf<number | null>();
    expectTypeOf<AdminUserInsightsResponse['windowId']>().toEqualTypeOf<string | null>();
    expectTypeOf<AdminUserInsightsResponse['periodEnd']>().toEqualTypeOf<string | null>();
  });
});
