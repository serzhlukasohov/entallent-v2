import { describe, expect, it } from 'vitest';
import { buildV2IndexReport } from './build-v2-index-report';
import type { V2CohortQuestionInput, V2CohortReportInputSelection, V2CohortReportScope } from './select-v2-cohort-report-inputs.use-case';

const users = ['u1', 'u2', 'u3', 'u4', 'u5'];
const questionIds = ['q1', 'q2', 'q3'];
const scope: V2CohortReportScope = {
  tenantId: 'tenant', reportingCohortId: 'cohort', teamId: 'team', surveyDefinitionId: 'definition',
  periodStart: new Date('2026-10-01T00:00:00Z'), periodEnd: new Date('2026-11-01T00:00:00Z'),
  rosterUserIds: users, policyVersion: '1.0.0', requiredQuestionIds: questionIds,
  questionTitlesById: { q1: 'Question one', q2: 'Question two', q3: 'Question three' },
  questionVersionsById: { q1: '1', q2: '1', q3: '1' },
  windowIdsByUser: [], questions: [],
};

function row(userId: string, questionId: string, score: number): V2CohortQuestionInput {
  return {
    id: `${userId}-${questionId}`, userId, surveyWindowId: `w-${userId}`, questionId,
    questionVersion: '1', deidentifiedSummary: 'private-safe source summary',
    outcome: 'scored', score, scoringPolicyVersion: '1.0.0', confirmedAt: new Date('2026-10-10T00:00:00Z'),
  };
}

function selection(questions: V2CohortQuestionInput[]): V2CohortReportInputSelection {
  return { eligible: true, requiredContributorCount: 5, contributorUserIds: users,
    scoredContributorUserIds: users, questionInsightIds: questions.map((question) => question.id), questions };
}

describe('buildV2IndexReport', () => {
  it('averages complete employees without rounding before the team result and omits source text', () => {
    const questions = users.flatMap((userId, index) => questionIds.map((id) => row(userId, id, 41 + index + questionIds.indexOf(id))));
    const report = buildV2IndexReport({ scope, selection: selection(questions), questionGroup: 'growth', reportKind: 'intermediate' });
    expect(report?.message).toContain('Index: 44.0/100 (5 contributors)');
    expect(report?.message).not.toContain('private-safe source summary');
    expect(report?.sourceQuestionInsightIds).toHaveLength(15);
  });

  it('shows an eligible final question without inventing a partial employee Index', () => {
    const questions = users.map((userId) => row(userId, 'q1', 60));
    const report = buildV2IndexReport({ scope, selection: selection(questions), questionGroup: 'growth', reportKind: 'final' });
    expect(report?.message).toContain('Question one: 60.0/100 (5 contributors)');
    expect(report?.message).not.toContain('Index:');
    expect(report?.sourceQuestionInsightIds).toHaveLength(5);
  });

  it('suppresses a final question contributed by fewer than five people', () => {
    const questions = users.slice(0, 4).map((userId) => row(userId, 'q1', 60));
    expect(buildV2IndexReport({ scope, selection: selection(questions), questionGroup: 'growth', reportKind: 'final' })).toBeNull();
  });
});
