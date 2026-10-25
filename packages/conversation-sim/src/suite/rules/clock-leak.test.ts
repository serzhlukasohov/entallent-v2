import { describe, expect, it } from 'vitest';
import { clockLeak } from './clock-leak';
import { outbound, syntheticRun } from './synthetic-run';

const at = { id: 'L0.C1', evaluatedAt: 'conversation' };
// syntheticRun stamps step n at 2026-01-05T10:00Z + n minutes.
const clock = { from: '2026-01-05T10:00:00.000Z', to: '2026-01-05T10:02:00.000Z' };

describe('clock-leak', () => {
  it('PASSes when every timestamp is inside the inclusive range', () => {
    expect(clockLeak.run({ ...syntheticRun('X-01.J', ['a', 'b']), clock }, at)).toEqual({ status: 'PASS' });
  });

  it('FAILs with the message id and timestamp of each leak', () => {
    const run = { ...syntheticRun('X-01.J', ['a', 'b', 'c']), clock };
    expect(clockLeak.run(run, at)).toEqual({
      status: 'FAIL',
      evidence: 'X-01.J-m3 2026-01-05T10:03:00.000Z\nclock 2026-01-05T10:00:00.000Z .. 2026-01-05T10:02:00.000Z',
    });
  });

  it('checks unsolicited messages and the window too', () => {
    const base = { ...syntheticRun('X-01.J', ['a']), clock };
    const leak = { id: 'u1', text: 'Late.', occurredAt: '2026-01-05T09:59:59.999Z', metadata: {} };
    const run = { ...base, steps: [{ ...base.steps[0]!, unsolicited: [leak] }] };
    const range = `clock ${clock.from} .. ${clock.to}`;
    expect(clockLeak.run(run, at)).toEqual({ status: 'FAIL', evidence: `u1 2026-01-05T09:59:59.999Z\n${range}` });
    const windowed = {
      ...base,
      observed: [...base.observed, 'window.outbound' as const],
      window: { from: clock.from, to: clock.to, outbound: [{ ...leak, id: 'w1' }] },
    };
    expect(clockLeak.run(windowed, at)).toEqual({ status: 'FAIL', evidence: `w1 2026-01-05T09:59:59.999Z\n${range}` });
  });

  it('is NOT_OBSERVABLE no-clock-range without a clock', () => {
    expect(clockLeak.run(syntheticRun('X-01.J', ['a']), at)).toEqual({ status: 'NOT_OBSERVABLE', evidence: 'no-clock-range' });
  });

  it('lists every leak and the range once', () => {
    const run = { ...syntheticRun('X-01.J', ['a', 'b', 'c', 'd']), clock: { ...clock, to: '2026-01-05T10:01:00.000Z' } };
    const outcome = clockLeak.run(run, at);
    expect(outcome.status).toBe('FAIL');
    expect(outcome.evidence!.split('\n')).toEqual([
      'X-01.J-m2 2026-01-05T10:02:00.000Z',
      'X-01.J-m3 2026-01-05T10:03:00.000Z',
      'X-01.J-m4 2026-01-05T10:04:00.000Z',
      'clock 2026-01-05T10:00:00.000Z .. 2026-01-05T10:01:00.000Z',
    ]);
  });

  it('is NOT_OBSERVABLE no-messages when the run recorded nothing, never a PASS', () => {
    expect(clockLeak.run({ ...syntheticRun('X-01.J', []), clock }, at)).toEqual({ status: 'NOT_OBSERVABLE', evidence: 'no-messages' });
    expect(clockLeak.run({ ...syntheticRun('X-01.J', [null, null]), clock }, at)).toEqual({
      status: 'NOT_OBSERVABLE',
      evidence: 'no-messages',
    });
  });

  it('checks a window-only observation run and FAILs its leak', () => {
    const run = {
      ...syntheticRun('P-06', [], ['window.outbound']),
      window: { from: clock.from, to: clock.to, outbound: [outbound('w1', '2026-01-05T10:01:00.000Z'), outbound('w2', '2026-01-05T10:05:00.000Z')] },
      clock,
    };
    expect(clockLeak.run(run, at)).toEqual({
      status: 'FAIL',
      evidence: `w2 2026-01-05T10:05:00.000Z\nclock ${clock.from} .. ${clock.to}`,
    });
  });

  it('ignores collections the run did not declare', () => {
    const base = { ...syntheticRun('X-01.J', ['a']), clock };
    const run = { ...base, window: { from: clock.from, to: clock.to, outbound: [outbound('w1', '2026-01-05T11:00:00.000Z')] } };
    expect(clockLeak.run(run, at)).toEqual({ status: 'PASS' });
  });

  it('is NOT_OBSERVABLE when neither reply.messages nor window.outbound is declared', () => {
    const run = { ...syntheticRun('X-01.J', ['a']), clock, observed: ['events' as const] };
    expect(clockLeak.requires).toEqual([]);
    expect(clockLeak.run(run, at)).toEqual({ status: 'NOT_OBSERVABLE', evidence: 'unobservable:reply.messages@L0' });
  });

  it('takes no params beyond an empty object', () => {
    expect(clockLeak.params!.safeParse(undefined).success).toBe(true);
    expect(clockLeak.params!.safeParse({ slackMs: 1 }).success).toBe(false);
  });
});
