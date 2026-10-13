import { describe, expect, it } from 'vitest';
import {
  clarifyQuestion,
  cutOffQuestions,
  declineQuestion,
  hasCompleteIndexInput,
  resolveQuestionBundle,
  type QuestionInsightState,
} from './question-insight-lifecycle';

const pending: QuestionInsightState[] = [
  { questionId: 'q1', status: 'pending_confirmation' },
  { questionId: 'q2', status: 'pending_confirmation' },
  { questionId: 'q3', status: 'pending_confirmation' },
];

describe('question-level bundle lifecycle', () => {
  it('confirms all three meanings from one agreement', () => {
    expect(resolveQuestionBundle(pending, { kind: 'agree' }).map((q) => q.status))
      .toEqual(['confirmed', 'confirmed', 'confirmed']);
  });

  it('keeps accepted meanings while one waits for clarification', () => {
    const transitions = resolveQuestionBundle(pending, {
      kind: 'partial', acceptedQuestionIds: ['q1', 'q3'], disputedQuestionIds: ['q2'],
    });
    expect(transitions.map((q) => q.status)).toEqual(['confirmed', 'pending_clarification', 'confirmed']);
    expect(clarifyQuestion(transitions[1]).status).toBe('confirmed');
    expect(() => clarifyQuestion(transitions[0])).toThrow('question_not_pending_clarification');
  });

  it('rejects incomplete or overlapping partial mappings', () => {
    expect(() => resolveQuestionBundle(pending, {
      kind: 'partial', acceptedQuestionIds: ['q1'], disputedQuestionIds: ['q1', 'q2'],
    })).toThrow('question_bundle_partial_mapping_invalid');
  });

  it('purges declined or fully rejected temporary meanings', () => {
    expect(declineQuestion({ questionId: 'q2', status: 'pending_clarification' }))
      .toMatchObject({ status: 'declined', purgeTemporary: true });
    expect(resolveQuestionBundle(pending, { kind: 'reject' }))
      .toEqual(pending.map((q) => ({ ...q, status: 'reset', purgeTemporary: true })));
  });

  it('leaves silence pending and converts only unresolved states at cutoff', () => {
    const states: QuestionInsightState[] = [
      { questionId: 'q1', status: 'confirmed' },
      { questionId: 'q2', status: 'pending_clarification' },
      { questionId: 'q3', status: 'declined' },
    ];
    expect(states[1].status).toBe('pending_clarification');
    expect(cutOffQuestions(states)).toEqual([{ questionId: 'q2', status: 'no_data', purgeTemporary: true }]);
  });
});

describe('complete Index input', () => {
  it('requires three valid question scores under one policy', () => {
    const scores = [
      { questionId: 'q1', score: 0, scoringPolicyVersion: 'v2' },
      { questionId: 'q2', score: 54.25, scoringPolicyVersion: 'v2' },
      { questionId: 'q3', score: 100, scoringPolicyVersion: 'v2' },
    ];
    expect(hasCompleteIndexInput(['q1', 'q2', 'q3'], scores)).toBe(true);
    expect(hasCompleteIndexInput(['q1', 'q2', 'q3'], scores.slice(0, 2))).toBe(false);
    expect(hasCompleteIndexInput(['q1', 'q2', 'q3'], [...scores.slice(0, 2), { ...scores[2], score: NaN }]))
      .toBe(false);
    expect(hasCompleteIndexInput(['q1', 'q2', 'q3'], [...scores.slice(0, 2), { ...scores[2], scoringPolicyVersion: 'v3' }]))
      .toBe(false);
  });
});
