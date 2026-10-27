import { describe, expect, it } from 'vitest';
import { proactiveInitiated } from './proactive-initiated';
import { outbound, windowRun } from './synthetic-run';

const at = { id: 'P-06.C1', evaluatedAt: 'observation-window' };

describe('proactive-initiated', () => {
  it('PASSes when the window holds a proactive_check_in message', () => {
    expect(proactiveInitiated.run(windowRun('P-06', [outbound('m1', '2026-01-06T10:00:00.000Z')]), at)).toEqual({
      status: 'PASS',
    });
  });

  it('FAILs with no initiation in the window', () => {
    expect(proactiveInitiated.run(windowRun('P-06', []), at)).toEqual({
      status: 'FAIL',
      evidence: 'initiations: 0 (expected at least 1; 0 outbound in window)',
    });
  });

  it('counts no initiation when outbound messages lack metadata.messageType (broken 12.7 contract)', () => {
    const run = windowRun('P-06', [
      outbound('m1', '2026-01-06T10:00:00.000Z', null),
      outbound('m2', '2026-01-08T10:00:00.000Z', 'reply'),
    ]);
    expect(proactiveInitiated.run(run, at)).toMatchObject({ status: 'FAIL', evidence: expect.stringMatching(/^initiations: 0 /) });
  });

  it('applies the default min when params omit it and honours an explicit min', () => {
    const run = windowRun('P-06', [outbound('m1', '2026-01-06T10:00:00.000Z')]);
    expect(proactiveInitiated.run(run, at, {}).status).toBe('PASS');
    expect(proactiveInitiated.run(run, at, { min: 2 }).status).toBe('FAIL');
  });

  it('is NOT_OBSERVABLE no-window when window.outbound is declared but the window is missing', () => {
    const run = { ...windowRun('P-06', []), window: undefined };
    expect(proactiveInitiated.run(run, at)).toEqual({ status: 'NOT_OBSERVABLE', evidence: 'no-window' });
  });

  it('is NOT_OBSERVABLE when window.outbound is not declared', () => {
    const run = { ...windowRun('P-06', []), observed: ['events' as const] };
    expect(proactiveInitiated.run(run, at)).toEqual({ status: 'NOT_OBSERVABLE', evidence: 'unobservable:window.outbound@L0' });
  });

  it('rejects unknown params', () => {
    expect(proactiveInitiated.params!.safeParse({ minimum: 1 }).success).toBe(false);
  });
});
