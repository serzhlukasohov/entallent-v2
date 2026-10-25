import { describe, expect, it } from 'vitest';
import { stateEquals } from './state-equals';
import { sameValue } from './state';
import { stateFixtureRun } from './synthetic-run';

const at = { id: 'P-09.C3', evaluatedAt: 'state' };
const progress = (answered: number) => ({ answered, total: 5 });
const run = stateFixtureRun(
  'P-09.A1',
  { before: { questionProgress: progress(1) }, after: { questionProgress: progress(2) }, afterStep: { '1': { stagedBundleCount: 1 } } },
  ['state.questionProgress', 'state.stagedBundleCount'],
);

describe('state-equals', () => {
  it('PASSes when the snapshot value equals expected', () => {
    expect(stateEquals.run(run, at, { query: 'questionProgress', at: 'after', expected: progress(2) })).toEqual({ status: 'PASS' });
    expect(stateEquals.run(run, at, { query: 'stagedBundleCount', at: 'after-step:1', expected: 1 })).toEqual({ status: 'PASS' });
  });

  it('FAILs with the actual and expected values', () => {
    expect(stateEquals.run(run, at, { query: 'questionProgress', at: 'before', expected: progress(2) })).toEqual({
      status: 'FAIL',
      evidence: 'state.questionProgress@before: {"answered":1,"total":5} (expected {"answered":2,"total":5})',
    });
  });

  it('is NOT_OBSERVABLE state-not-read when the snapshot lacks the key', () => {
    expect(stateEquals.run(run, at, { query: 'stagedBundleCount', at: 'after', expected: 1 })).toEqual({
      status: 'NOT_OBSERVABLE',
      evidence: 'state-not-read:stagedBundleCount@after',
    });
    expect(stateEquals.run(run, at, { query: 'stagedBundleCount', at: 'after-step:2', expected: 1 })).toEqual({
      status: 'NOT_OBSERVABLE',
      evidence: 'state-not-read:stagedBundleCount@after-step:2',
    });
  });

  it('is NOT_OBSERVABLE when the query is not declared', () => {
    expect(stateEquals.run(run, at, { query: 'outboundCount', at: 'after', expected: 1 })).toEqual({
      status: 'NOT_OBSERVABLE',
      evidence: 'unobservable:state.outboundCount@L0',
    });
  });

  it('validates expected against the query value schema', () => {
    const schema = stateEquals.params!;
    expect(schema.safeParse({ query: 'questionProgress', at: 'after', expected: progress(2) }).success).toBe(true);
    const bad = schema.safeParse({ query: 'questionProgress', at: 'after', expected: 2 });
    expect(bad.success).toBe(false);
    expect(bad.error?.issues[0]?.path[0]).toBe('expected');
    expect(schema.safeParse({ query: 'stagedBundleCount', at: 'after', expected: { answered: 1, total: 2 } }).success).toBe(false);
    expect(schema.safeParse({ query: 'stagedBundleCount', at: 'later', expected: 1 }).success).toBe(false);
  });

  it('applies deep equality that tells arrays from objects', () => {
    expect(sameValue({ answered: 1, total: 5 }, { total: 5, answered: 1 })).toBe(true);
    expect(sameValue({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })).toBe(true);
    expect(sameValue([], {})).toBe(false);
    expect(sameValue({}, [])).toBe(false);
    expect(sameValue({ 0: 'x' }, ['x'])).toBe(false);
    expect(sameValue([1, 2], [2, 1])).toBe(false);
    expect(sameValue({ a: undefined }, { b: undefined })).toBe(false);
    expect(sameValue(null, {})).toBe(false);
  });
});
