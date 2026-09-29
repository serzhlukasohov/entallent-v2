import { describe, expect, it } from 'vitest';
import { validateQuestionBundleVerdict } from './question-bundle-verdict';

const ids = ['q-a', 'q-b', 'q-c'];

describe('validateQuestionBundleVerdict', () => {
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
