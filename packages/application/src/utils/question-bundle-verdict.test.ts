import { describe, expect, it } from 'vitest';
import { validateQuestionBundleVerdict } from './question-bundle-verdict';

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
