import { describe, expect, it } from 'vitest';
import { hasCompleteV2ScoringPolicy, isApprovedQuestionRubric } from './question-scoring-policy';

const questionGroups = {
  q12_expectations: 'autonomy', q12_strengths_opportunity: 'autonomy', q12_opinions_count: 'autonomy',
  wellbeing_at_work: 'belonging', q12_supervisor_cares: 'belonging',
  belonging_psychological_safety: 'belonging',
  role_clarity: 'growth', professional_growth: 'growth', q12_progress_discussion: 'growth',
  q12_recognition: 'purpose', purpose_meaning: 'purpose', purpose_contribution: 'purpose',
};
const questions = Object.entries(questionGroups).map(([stableKey, questionGroup]) => ({
  stableKey, questionGroup,
  responseType: 'open_ended' as const,
}));
const rubric = { version: 'approved-v1', instructions: 'Assess the confirmed meaning.', anchors: [
  { score: 0, description: 'Low' }, { score: 100, description: 'High' },
] };

describe('V2 scoring policy readiness', () => {
  it('requires an approved rubric for every one of the twelve question identities', () => {
    const complete = Object.fromEntries(questions.map((question) => [question.stableKey, rubric]));
    expect(hasCompleteV2ScoringPolicy(questions, complete)).toBe(true);
    expect(hasCompleteV2ScoringPolicy(questions, { ...complete, purpose_contribution: undefined })).toBe(false);
    expect(hasCompleteV2ScoringPolicy(questions, { ...complete, professional_growth: {
      ...rubric, anchors: [{ score: 0, description: 'Low' }],
    } })).toBe(false);
  });

  it('rejects a V1 definition with a different group layout', () => {
    const complete = Object.fromEntries(questions.map((question) => [question.stableKey, rubric]));
    expect(hasCompleteV2ScoringPolicy(questions.map((question) => question.questionGroup === 'growth'
      ? { ...question, questionGroup: 'mastery' }
      : question), complete)).toBe(false);
  });

  it('rejects duplicate numeric anchors before a company-cycle policy is frozen', () => {
    const duplicate = { ...rubric, anchors: [
      { score: 50, description: 'Low' }, { score: 50, description: 'High' },
    ] };
    expect(isApprovedQuestionRubric(duplicate)).toBe(false);
    const complete = Object.fromEntries(questions.map((question) => [question.stableKey, rubric]));
    expect(hasCompleteV2ScoringPolicy(questions, { ...complete, purpose_meaning: duplicate })).toBe(false);
    expect(isApprovedQuestionRubric({ ...rubric, anchors: [
      { score: 0, description: 'Low' }, { score: 50, description: 'Middle' },
      { score: 100, description: 'High' },
    ] })).toBe(true);
  });

  it('rejects renamed questions or swapped keys even when every group still has three', () => {
    const complete = Object.fromEntries(questions.map((question) => [question.stableKey, rubric]));
    expect(hasCompleteV2ScoringPolicy(questions.map((question) => question.stableKey === 'role_clarity'
      ? { ...question, stableKey: 'growth_1' }
      : question), complete)).toBe(false);
    expect(hasCompleteV2ScoringPolicy(questions.map((question) =>
      question.stableKey === 'role_clarity' ? { ...question, questionGroup: 'autonomy' }
        : question.stableKey === 'q12_expectations' ? { ...question, questionGroup: 'growth' }
          : question), complete)).toBe(false);
  });
});
