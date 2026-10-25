import { describe, expect, it } from 'vitest';
import { replyPresent } from './reply-present';
import { syntheticRun } from './synthetic-run';

const at = (evaluatedAt: string) => ({ id: 'P-01.C1', evaluatedAt });

describe('reply-present', () => {
  it('needs reply.messages and never reply.text, so it decides silence at L0', () => {
    expect(replyPresent.requires).toEqual(['reply.messages']);
  });

  it('PASSes a step with a reply', () => {
    expect(replyPresent.run(syntheticRun('P-01.A1', ['Hello.'], ['reply.messages']), at('reply:1'))).toEqual({ status: 'PASS' });
  });

  it('FAILs silence with no-reply (turn 1)', () => {
    expect(replyPresent.run(syntheticRun('P-01.A1', [null], ['reply.messages']), at('reply:1'))).toEqual({
      status: 'FAIL',
      evidence: 'no-reply (turn 1)',
    });
  });

  it('FAILs every silent step in conversation scope', () => {
    const run = syntheticRun('P-01.J', ['Hello.', null, 'Okay.', null], ['reply.messages']);
    expect(replyPresent.run(run, at('conversation'))).toEqual({
      status: 'FAIL',
      evidence: 'no-reply (turn 2)\nno-reply (turn 4)',
    });
    expect(replyPresent.run(syntheticRun('P-01.J', ['Hello.', 'Okay.'], ['reply.messages']), at('conversation'))).toEqual({
      status: 'PASS',
    });
  });

  it('FAILs an all-silent conversation', () => {
    const run = syntheticRun('P-01.J', [null, null], ['reply.messages']);
    expect(replyPresent.run(run, at('conversation'))).toEqual({
      status: 'FAIL',
      evidence: 'no-reply (turn 1)\nno-reply (turn 2)',
    });
  });

  it('is NOT_OBSERVABLE without reply.messages', () => {
    expect(replyPresent.run(syntheticRun('P-01.A1', ['Hello.'], ['reply.text']), at('reply:1'))).toEqual({
      status: 'NOT_OBSERVABLE',
      evidence: 'unobservable:reply.messages@L0',
    });
  });
});
