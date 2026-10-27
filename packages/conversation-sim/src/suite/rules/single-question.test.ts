import { describe, expect, it } from 'vitest';
import { singleQuestion } from './single-question';
import { syntheticRun } from './synthetic-run';

const at = (evaluatedAt: string) => ({ id: 'X-01.C1', evaluatedAt });

describe('single-question', () => {
  it('PASSes a reply with exactly one question', () => {
    expect(singleQuestion.run(syntheticRun('X-01.A1', ['Noted. Which release lands first?']), at('reply:1'))).toEqual({
      status: 'PASS',
    });
  });

  it('FAILs with none when the reply asks no question', () => {
    expect(singleQuestion.run(syntheticRun('X-01.A1', ['Noted. Good luck.']), at('reply:1'))).toEqual({
      status: 'FAIL',
      evidence: 'turn 1 — none',
    });
  });

  it('FAILs with the questions found when the reply asks two', () => {
    const run = syntheticRun('X-01.A1', ['Which release lands first? And who owns it?']);
    expect(singleQuestion.run(run, at('reply:1'))).toEqual({
      status: 'FAIL',
      evidence: 'turn 1 — Which release lands first? / And who owns it?',
    });
  });

  it('is NOT_OBSERVABLE without reply.text', () => {
    const run = syntheticRun('X-01.A1', ['Which one?'], ['reply.messages']);
    expect(singleQuestion.run(run, at('reply:1'))).toEqual({ status: 'NOT_OBSERVABLE', evidence: 'unobservable:reply.text@L0' });
  });
});
