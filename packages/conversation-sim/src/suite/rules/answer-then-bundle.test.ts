import { describe, expect, it } from 'vitest';
import type { CaseRun, TurnTrace } from '../schema';
import { answerThenBundle } from './answer-then-bundle';
import { syntheticRun } from './synthetic-run';

const at = (evaluatedAt: string) => ({ id: 'P-10.C1', evaluatedAt });

function withTurns(run: CaseRun, turns: Array<TurnTrace | undefined>): CaseRun {
  return {
    ...run,
    steps: run.steps.map((step, position) => {
      const turn = turns[position];
      return turn === undefined ? step : { ...step, turn };
    }),
  };
}

const observed = ['turn.bundleReply' as const];

describe('answer-then-bundle', () => {
  it('PASSes when the selected step bundleReply is answer_then_bundle', () => {
    const run = withTurns(syntheticRun('P-10.A1', ['x'], observed), [{ bundleReply: 'answer_then_bundle' }]);
    expect(answerThenBundle.run(run, at('reply:1'))).toEqual({ status: 'PASS' });
  });

  it('FAILs with the observed value', () => {
    const run = withTurns(syntheticRun('P-10.A1', ['x'], observed), [{ bundleReply: 'bundle_without_reply' }]);
    expect(answerThenBundle.run(run, at('reply:1'))).toEqual({
      status: 'FAIL',
      evidence: 'turn 1 — bundleReply:bundle_without_reply',
    });
  });

  it('FAILs bundleReply:none when the turn has no bundle outcome', () => {
    const run = withTurns(syntheticRun('P-10.A1', ['x'], observed), [{ mode: 'coach' }]);
    expect(answerThenBundle.run(run, at('reply:1'))).toEqual({ status: 'FAIL', evidence: 'turn 1 — bundleReply:none' });
    expect(answerThenBundle.run(syntheticRun('P-10.A1', ['x'], observed), at('reply:1'))).toEqual({
      status: 'FAIL',
      evidence: 'turn 1 — bundleReply:none',
    });
  });

  it('PASSes in conversation scope when any one step qualifies, and only that step passes at reply:<n>', () => {
    const run = withTurns(syntheticRun('P-10.J', ['a', 'b', 'c'], observed), [
      { bundleReply: 'bundle_without_reply' },
      { bundleReply: 'answer_then_bundle' },
      {},
    ]);
    expect(answerThenBundle.run(run, at('conversation'))).toEqual({ status: 'PASS' });
    expect(answerThenBundle.run(run, at('reply:2'))).toEqual({ status: 'PASS' });
    expect(answerThenBundle.run(run, at('reply:1'))).toEqual({
      status: 'FAIL',
      evidence: 'turn 1 — bundleReply:bundle_without_reply',
    });
  });

  it('FAILs in conversation scope with per-turn evidence when no step qualifies', () => {
    const run = withTurns(syntheticRun('P-10.J', ['a', 'b', 'c'], observed), [
      { bundleReply: 'bundle_without_reply' },
      {},
      { bundleReply: 'bundle_without_reply' },
    ]);
    expect(answerThenBundle.run(run, at('conversation'))).toEqual({
      status: 'FAIL',
      evidence: 'turn 1 — bundleReply:bundle_without_reply\nturn 2 — bundleReply:none\nturn 3 — bundleReply:bundle_without_reply',
    });
  });

  it('is NOT_OBSERVABLE when turn.bundleReply is not declared', () => {
    expect(answerThenBundle.run(syntheticRun('P-10.A1', ['x']), at('reply:1'))).toEqual({
      status: 'NOT_OBSERVABLE',
      evidence: 'unobservable:turn.bundleReply@L0',
    });
  });
});
