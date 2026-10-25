import { describe, expect, it } from 'vitest';
import { causeQuestionPresent } from './cause-question-present';
import { syntheticRun } from './synthetic-run';

const at = (evaluatedAt: string) => ({ id: 'X-01.C1', evaluatedAt });

describe('cause-question-present', () => {
  it('PASSes a reply with at least one question (the meaning companion judges the cause)', () => {
    const run = syntheticRun('X-01.A1', ['That is a lot. What is slowing the handover? Who else is involved?']);
    expect(causeQuestionPresent.run(run, at('reply:1'))).toEqual({ status: 'PASS' });
  });

  it('FAILs a reply without a question', () => {
    expect(causeQuestionPresent.run(syntheticRun('X-01.A1', ['That is a lot. Rest well.']), at('reply:1'))).toEqual({
      status: 'FAIL',
      evidence: 'turn 1 — no question',
    });
  });

  it('FAILs observed silence', () => {
    expect(causeQuestionPresent.run(syntheticRun('X-01.A1', [null]), at('reply:1'))).toEqual({
      status: 'FAIL',
      evidence: 'no-reply (turn 1)',
    });
  });

  it('is NOT_OBSERVABLE for an observation-window criterion', () => {
    expect(causeQuestionPresent.run(syntheticRun('X-01.A1', ['Why?']), at('observation-window')).status).toBe('NOT_OBSERVABLE');
  });
});
