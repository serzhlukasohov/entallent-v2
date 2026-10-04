import { describe, expect, it } from 'vitest';
import { selectV2CohortReportInputs, type V2CohortReportScope } from './select-v2-cohort-report-inputs.use-case';

const start = new Date('2026-01-01T00:00:00Z');
const end = new Date('2026-02-01T00:00:00Z');
const roster = ['a', 'b', 'c', 'd', 'e'];
function fixture(): V2CohortReportScope {
  return {
    tenantId: 'tenant', reportingCohortId: 'cohort', teamId: 'team', surveyDefinitionId: 'definition',
    periodStart: start, periodEnd: end, rosterUserIds: roster,
    policyVersion: 'policy-1', requiredQuestionIds: ['q1', 'q2', 'q3'],
    questionTitlesById: { q1: 'Question one', q2: 'Question two', q3: 'Question three' },
    questionVersionsById: { q1: '1', q2: '1', q3: '1' },
    windowIdsByUser: roster.map((userId) => ({ userId, windowId: `w-${userId}`, policyVersion: 'policy-1' })),
    questions: roster.flatMap((userId) => ['q1', 'q2', 'q3'].map((questionId) => ({
      id: `${userId}-${questionId}`, userId, surveyWindowId: `w-${userId}`, questionId,
      questionVersion: '1', deidentifiedSummary: 'Safe summary.', outcome: 'scored' as const,
      score: 70, scoringPolicyVersion: 'policy-1', confirmedAt: start,
    }))),
  };
}

describe('selectV2CohortReportInputs', () => {
  it('uses each complete frozen contributor once for intermediate inputs', () => {
    const selected = selectV2CohortReportInputs(fixture(), 'intermediate', end);
    expect(selected).toMatchObject({ eligible: true, requiredContributorCount: 5, contributorUserIds: roster });
    expect(selected.questionInsightIds).toHaveLength(15);
  });

  it('uses partial final scored questions only after cutoff and never fills an Index', () => {
    const scope = fixture();
    scope.questions = scope.questions.filter((row) => row.userId !== 'e' || row.questionId === 'q1');
    expect(selectV2CohortReportInputs(scope, 'final', start).reason).toBe('before_cutoff');
    const selected = selectV2CohortReportInputs(scope, 'final', end);
    expect(selected.eligible).toBe(true);
    expect(selected.questionInsightIds).toHaveLength(13);
    expect(selected.questions.filter((row) => row.userId === 'e')).toHaveLength(1);
    expect(selectV2CohortReportInputs(scope, 'intermediate', end).reason).toBe('insufficient_contributors');
  });

  it('fails closed on duplicate, wrong window, mixed policy, and too few contributors', () => {
    for (const change of [
      (scope: V2CohortReportScope) => scope.questions.push(scope.questions[0]!),
      (scope: V2CohortReportScope) => { scope.questions[0]!.surveyWindowId = 'other'; },
      (scope: V2CohortReportScope) => { scope.questions[0]!.scoringPolicyVersion = 'other'; },
      (scope: V2CohortReportScope) => { scope.windowIdsByUser[0]!.policyVersion = 'other'; },
    ]) {
      const scope = fixture(); change(scope);
      expect(selectV2CohortReportInputs(scope, 'intermediate', end).reason).toBe('invalid_scope');
    }
    const under = fixture();
    under.questions = under.questions.filter((row) => row.userId !== 'e');
    expect(selectV2CohortReportInputs(under, 'final', end).reason).toBe('insufficient_contributors');
  });
});
