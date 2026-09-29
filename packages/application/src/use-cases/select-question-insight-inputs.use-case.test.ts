import { describe, expect, it } from 'vitest';
import {
  SelectQuestionInsightInputsUseCase,
  type QuestionInsightInputRecord,
  type PriorQuestionScoreRecord,
} from './select-question-insight-inputs.use-case';

const input = {
  tenantId: 'tenant',
  userId: 'person',
  surveyWindowId: 'cycle',
  surveyDefinitionId: 'definition',
  questionGroup: 'autonomy',
  requiredQuestionIds: ['q1', 'q2', 'q3'],
  reportKind: 'final' as const,
  now: new Date('2026-10-01T00:00:00Z'),
};

function question(questionId: string): QuestionInsightInputRecord {
  return {
    questionId,
    questionVersion: 'v2',
    deidentifiedSummary: `Generalized ${questionId} signal`,
    score: 72,
    scoringPolicyVersion: 'policy-1',
    confirmedAt: new Date('2026-09-28T00:00:00Z'),
  };
}

function previous(questionId: string, score: number): PriorQuestionScoreRecord {
  return {
    questionId, questionVersion: 'v2', score, scoringPolicyVersion: 'policy-1',
    periodStart: new Date('2026-04-01T00:00:00Z'),
    periodEnd: new Date('2026-07-01T00:00:00Z'),
    confirmedAt: new Date('2026-06-30T00:00:00Z'),
  };
}

function selector(rows: QuestionInsightInputRecord[], prior: PriorQuestionScoreRecord[] = []) {
  return new SelectQuestionInsightInputsUseCase({
    findWindowPeriod: async () => ({
      periodStart: new Date('2026-07-01T00:00:00Z'),
      periodEnd: new Date('2026-10-01T00:00:00Z'),
    }),
    findFinalizedQuestions: async (scope) => {
      expect(scope).toMatchObject({
        tenantId: input.tenantId, userId: input.userId, surveyWindowId: input.surveyWindowId,
        surveyDefinitionId: input.surveyDefinitionId, questionGroup: input.questionGroup,
      });
      return rows;
    },
    findPriorFinalizedQuestionScores: async (scope) => {
      expect([...scope.questionIds].sort()).toEqual(rows.map((row) => row.questionId).sort());
      return prior;
    },
  });
}

describe('SelectQuestionInsightInputsUseCase', () => {
  it('marks only complete three-question coverage eligible for intermediate input', async () => {
    const result = await selector([question('q3'), question('q1'), question('q2')]).execute(input);
    expect(result.intermediateEligible).toBe(true);
    expect(result.intermediateQuestions).toEqual([]);
    expect(result.finalQuestions.map((row) => row.questionId)).toEqual(['q1', 'q2', 'q3']);
    expect(result.questionTrends).toEqual(['q1', 'q2', 'q3'].map((questionId) => ({
      questionId, direction: 'baseline', delta: null, baselineReason: 'no_prior_score',
    })));
    expect(result).not.toHaveProperty('indexScore');
  });

  it('supplies one or two confirmed questions for final input without a partial index score', async () => {
    for (const ids of [['q1'], ['q1', 'q3']]) {
      const result = await selector(ids.map(question)).execute(input);
      expect(result.intermediateEligible).toBe(false);
      expect(result.intermediateQuestions).toEqual([]);
      expect(result.finalQuestions.map((row) => row.questionId)).toEqual(ids);
      expect(result).not.toHaveProperty('indexScore');
    }
  });

  it('provides no negative or neutral evidence for an employee with no confirmed insights', async () => {
    await expect(selector([]).execute(input)).resolves.toEqual({
      intermediateEligible: false,
      intermediateQuestions: [],
      finalQuestions: [],
      questionTrends: [],
    });
  });

  it('does not supply partial intermediate input or any final input before cutoff', async () => {
    const partial = await selector([question('q1'), question('q2')]).execute({
      ...input, reportKind: 'intermediate', now: new Date('2026-09-30T00:00:00Z'),
    });
    expect(partial).toEqual({
      intermediateEligible: false, intermediateQuestions: [], finalQuestions: [], questionTrends: [],
    });
    const complete = await selector([question('q1'), question('q2'), question('q3')]).execute({
      ...input, reportKind: 'intermediate', now: new Date('2026-09-30T00:00:00Z'),
    });
    expect(complete.intermediateQuestions.map((row) => row.questionId)).toEqual(['q1', 'q2', 'q3']);
    expect(complete.finalQuestions).toEqual([]);
    await expect(selector([question('q1')]).execute({
      ...input, now: new Date('2026-09-30T00:00:00Z'),
    })).rejects.toThrow('question_insight_final_before_cutoff');
  });

  it('rejects duplicate, invalid, and mixed-policy analytical rows', async () => {
    await expect(selector([question('q1'), question('q1')]).execute(input))
      .rejects.toThrow('question_insight_input_invalid_record');
    await expect(selector([{ ...question('q1'), score: -1 }]).execute(input))
      .rejects.toThrow('question_insight_input_invalid_record');
    await expect(selector([question('q1'), { ...question('q2'), scoringPolicyVersion: 'policy-2' }]).execute(input))
      .rejects.toThrow('question_insight_input_mixed_scoring_policy');
  });

  it('rejects confirmations outside their half-open reporting window', async () => {
    await expect(selector([{ ...question('q1'), confirmedAt: new Date('2026-10-01T00:00:00Z') }])
      .execute(input)).rejects.toThrow('question_insight_input_invalid_record');
    await expect(selector([{ ...question('q1'), confirmedAt: new Date('2026-06-30T23:59:59Z') }])
      .execute({ ...input, reportKind: 'intermediate', now: new Date('2026-09-30T00:00:00Z') }))
      .rejects.toThrow('question_insight_input_invalid_record');
    await expect(selector([question('q1')], [
      { ...previous('q1', 70), confirmedAt: new Date('2026-07-01T00:00:00Z') },
    ]).execute(input)).rejects.toThrow('question_insight_prior_invalid_record');
  });

  it('treats every nonzero same-policy delta as directional without a threshold', async () => {
    const current = [question('q1'), question('q2'), question('q3')];
    const result = await selector(current, [
      previous('q1', 71.999), previous('q2', 72.001), previous('q3', 72),
    ]).execute(input);
    expect(result.questionTrends).toEqual([
      { questionId: 'q1', direction: 'improving', delta: expect.closeTo(0.001, 6) },
      { questionId: 'q2', direction: 'declining', delta: expect.closeTo(-0.001, 6) },
      { questionId: 'q3', direction: 'stable', delta: 0 },
    ]);
  });

  it('starts a new baseline on a policy or question version change', async () => {
    const result = await selector([question('q1'), question('q2')], [
      { ...previous('q1', 20), scoringPolicyVersion: 'policy-0' },
      { ...previous('q2', 20), questionVersion: 'v1' },
    ]).execute(input);
    expect(result.questionTrends).toEqual([
      { questionId: 'q1', direction: 'baseline', delta: null, baselineReason: 'policy_version_changed' },
      { questionId: 'q2', direction: 'baseline', delta: null, baselineReason: 'question_version_changed' },
    ]);
  });

  it('does not choose an arbitrary prior score after duplicate windows in one cycle', async () => {
    const result = await selector([question('q1')], [previous('q1', 70), previous('q1', 71)])
      .execute(input);
    expect(result.questionTrends).toEqual([{
      questionId: 'q1', direction: 'baseline', delta: null, baselineReason: 'ambiguous_prior_score',
    }]);
  });
});
