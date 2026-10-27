import { describe, expect, it } from 'vitest';
import type { CaseRun } from '../schema';
import { bundleStaged } from './bundle-staged';
import { syntheticRun } from './synthetic-run';

const at = (evaluatedAt: string) => ({ id: 'P-09.C2', evaluatedAt });

function withMessages(run: CaseRun, step: number, metadata: Array<Record<string, unknown>>): CaseRun {
  return {
    ...run,
    steps: run.steps.map((observation) => {
      if (observation.index !== step) return observation;
      const messages = metadata.map((meta, position) => ({
        id: `${run.testId}-m${step}-${position}`,
        text: `part ${position + 1}`,
        occurredAt: '2026-01-05T10:01:00.000Z',
        metadata: meta,
      }));
      return { ...observation, reply: { messages, text: messages.map((message) => message.text).join('\n\n') } };
    }),
  };
}

describe('bundle-staged', () => {
  it('PASSes when any message of the selected reply carries v2ConfirmationBundle: true', () => {
    const run = withMessages(syntheticRun('P-09.A1', ['x']), 1, [{}, { v2ConfirmationBundle: true }]);
    expect(bundleStaged.run(run, at('reply:1'))).toEqual({ status: 'PASS' });
  });

  it('FAILs when no message carries the flag as true', () => {
    const run = withMessages(syntheticRun('P-09.A1', ['x']), 1, [{ v2ConfirmationBundle: false }, { v2ConfirmationBundle: 'true' }]);
    expect(bundleStaged.run(run, at('reply:1'))).toEqual({
      status: 'FAIL',
      evidence: 'turn 1 — no message with v2ConfirmationBundle: true',
    });
  });

  it('looks only at the selected step', () => {
    const run = withMessages(syntheticRun('P-09.J', ['a', 'b']), 1, [{ v2ConfirmationBundle: true }]);
    expect(bundleStaged.run(run, at('reply:2')).status).toBe('FAIL');
    expect(bundleStaged.run(run, at('conversation'))).toEqual({ status: 'PASS' });
  });

  it('PASSes in conversation scope when one step of several stages the bundle', () => {
    const run = withMessages(syntheticRun('P-09.J', ['a', 'b', 'c']), 2, [{ v2ConfirmationBundle: true }]);
    expect(bundleStaged.run(run, at('conversation'))).toEqual({ status: 'PASS' });
    expect(bundleStaged.run(run, at('reply:2'))).toEqual({ status: 'PASS' });
    expect(bundleStaged.run(run, at('reply:3'))).toEqual({
      status: 'FAIL',
      evidence: 'turn 3 — no message with v2ConfirmationBundle: true',
    });
  });

  it('FAILs in conversation scope with per-turn evidence when no step stages the bundle', () => {
    expect(bundleStaged.run(syntheticRun('P-09.J', ['a', 'b']), at('conversation'))).toEqual({
      status: 'FAIL',
      evidence: 'turn 1 — no message with v2ConfirmationBundle: true\nturn 2 — no message with v2ConfirmationBundle: true',
    });
  });

  it('is NOT_OBSERVABLE with the full field name when the run does not declare reply.messages', () => {
    const run: CaseRun = { ...syntheticRun('P-09.A1', ['x'], ['reply.text']), level: 'L1' };
    expect(bundleStaged.run(run, at('reply:1'))).toEqual({
      status: 'NOT_OBSERVABLE',
      evidence: 'unobservable:reply.messages[].metadata.v2ConfirmationBundle@L1',
    });
  });
});
