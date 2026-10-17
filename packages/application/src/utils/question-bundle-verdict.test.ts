import { describe, expect, it } from 'vitest';
import {
  MAX_QUESTION_CLARIFICATIONS, resolveCorrectedStatementVerdict, validateQuestionBundleVerdict,
} from './question-bundle-verdict';

const ids = ['q-a', 'q-b', 'q-c'];

describe('validateQuestionBundleVerdict', () => {
  it('accepts a single mapped supplement and rejects unmapped ids', () => {
    expect(validateQuestionBundleVerdict({ kind: 'agree' }, ['q-a'])).toEqual({ kind: 'agree' });
    expect(validateQuestionBundleVerdict({ kind: 'partial', acceptedQuestionIds: [],
      disputedQuestionIds: ['q-a'], declinedQuestionIds: [] }, ['q-a']))
      .toMatchObject({ kind: 'partial', disputedQuestionIds: ['q-a'] });
    expect(() => validateQuestionBundleVerdict({ kind: 'partial', acceptedQuestionIds: ['q-b'],
      disputedQuestionIds: [], declinedQuestionIds: [] }, ['q-a']))
      .toThrow('v2_confirmation_verdict_invalid');
  });
  it('accepts agreement, full rejection, and unrelated replies', () => {
    for (const kind of ['agree', 'reject', 'unrelated']) {
      expect(validateQuestionBundleVerdict({ kind }, ids)).toEqual({ kind });
    }
  });

  it('rejects contradictory or unrecognized fields before confirming any meaning', () => {
    for (const kind of ['agree', 'reject', 'unrelated']) {
      expect(() => validateQuestionBundleVerdict({
        kind, acceptedQuestionIds: ['q-a'], disputedQuestionIds: ['q-b'], declinedQuestionIds: ['q-c'],
      }, ids)).toThrow('v2_confirmation_verdict_invalid');
    }
    expect(() => validateQuestionBundleVerdict({
      kind: 'partial', acceptedQuestionIds: ['q-a'], disputedQuestionIds: ['q-b'],
      declinedQuestionIds: ['q-c'], override: 'agree',
    }, ids)).toThrow('v2_confirmation_verdict_invalid');
  });

  it('requires a complete, disjoint mapping for partial responses', () => {
    const partial = {
      kind: 'partial', acceptedQuestionIds: ['q-a'],
      disputedQuestionIds: ['q-b'], declinedQuestionIds: ['q-c'],
    };
    expect(validateQuestionBundleVerdict(partial, ids)).toEqual(partial);
    expect(() => validateQuestionBundleVerdict({
      ...partial, declinedQuestionIds: ['unknown'],
    }, ids)).toThrow('v2_confirmation_verdict_invalid');
    expect(() => validateQuestionBundleVerdict({
      ...partial, disputedQuestionIds: ['q-a'],
    }, ids)).toThrow('v2_confirmation_verdict_invalid');
  });
});

describe('resolveCorrectedStatementVerdict (GC round 3 S4b)', () => {
  const disputed = { kind: 'partial' as const, acceptedQuestionIds: [], disputedQuestionIds: ['q-b'], declinedQuestionIds: [] };
  const declined = { kind: 'partial' as const, acceptedQuestionIds: [], disputedQuestionIds: [], declinedQuestionIds: ['q-b'] };

  it('allows at most two clarification questions per question', () => {
    expect(MAX_QUESTION_CLARIFICATIONS).toBe(2);
  });

  it('turns a reject into one more clarification while the budget lasts', () => {
    expect(resolveCorrectedStatementVerdict({ kind: 'reject' }, 'q-b', 1)).toEqual(disputed);
  });

  it('keeps a dispute while the budget lasts', () => {
    expect(resolveCorrectedStatementVerdict(disputed, 'q-b', 1)).toEqual(disputed);
  });

  it('closes the question as declined once the budget is spent', () => {
    expect(resolveCorrectedStatementVerdict({ kind: 'reject' }, 'q-b', 2)).toEqual(declined);
    expect(resolveCorrectedStatementVerdict(disputed, 'q-b', 2)).toEqual(declined);
  });

  it('keeps agree and an explicit skip unchanged', () => {
    expect(resolveCorrectedStatementVerdict({ kind: 'agree' }, 'q-b', 2)).toEqual({ kind: 'agree' });
    expect(resolveCorrectedStatementVerdict(declined, 'q-b', 0)).toEqual(declined);
  });
});
