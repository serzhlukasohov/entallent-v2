import { describe, expect, it } from 'vitest';
import { proactiveSpacing } from './proactive-spacing';
import { outbound, windowRun } from './synthetic-run';

const at = { id: 'P-06.C2', evaluatedAt: 'observation-window' };

describe('proactive-spacing', () => {
  it('PASSes initiations exactly 48:00 h apart', () => {
    const run = windowRun('P-06', [outbound('m1', '2026-01-05T10:00:00.000Z'), outbound('m2', '2026-01-07T10:00:00.000Z')]);
    expect(proactiveSpacing.run(run, at)).toEqual({ status: 'PASS' });
  });

  it('FAILs initiations 47:59 h apart, naming both timestamps', () => {
    const run = windowRun('P-06', [outbound('m1', '2026-01-05T10:00:00.000Z'), outbound('m2', '2026-01-07T09:59:00.000Z')]);
    expect(proactiveSpacing.run(run, at)).toEqual({
      status: 'FAIL',
      evidence: '2026-01-05T10:00:00.000Z -> 2026-01-07T09:59:00.000Z (47:59 h < 48:00 h)',
    });
  });

  it('orders initiations by occurredAt and ignores non-proactive outbound', () => {
    const run = windowRun('P-06', [
      outbound('m3', '2026-01-09T10:00:00.000Z'),
      outbound('m1', '2026-01-05T10:00:00.000Z'),
      outbound('r1', '2026-01-06T10:00:00.000Z', null),
      outbound('m2', '2026-01-07T10:00:00.000Z'),
    ]);
    expect(proactiveSpacing.run(run, at)).toEqual({ status: 'PASS' });
  });

  it('compares instants across offsets', () => {
    const run = windowRun('P-06', [outbound('m1', '2026-01-05T12:00:00+02:00'), outbound('m2', '2026-01-07T10:00:00Z')]);
    expect(proactiveSpacing.run(run, at).status).toBe('PASS');
  });

  it('PASSes a single initiation', () => {
    expect(proactiveSpacing.run(windowRun('P-06', [outbound('m1', '2026-01-05T10:00:00.000Z')]), at)).toEqual({ status: 'PASS' });
  });

  it('is NOT_OBSERVABLE no-initiations with none in the window, and no-window without a window', () => {
    expect(proactiveSpacing.run(windowRun('P-06', [outbound('r1', '2026-01-05T10:00:00.000Z', null)]), at)).toEqual({
      status: 'NOT_OBSERVABLE',
      evidence: 'no-initiations',
    });
    const run = { ...windowRun('P-06', []), window: undefined };
    expect(proactiveSpacing.run(run, at)).toEqual({ status: 'NOT_OBSERVABLE', evidence: 'no-window' });
  });

  it('applies the 48 h default when params are omitted and honours minGapMs', () => {
    const run = windowRun('P-06', [outbound('m1', '2026-01-05T10:00:00.000Z'), outbound('m2', '2026-01-06T10:00:00.000Z')]);
    expect(proactiveSpacing.run(run, at, {}).status).toBe('FAIL');
    expect(proactiveSpacing.run(run, at, { minGapMs: 24 * 3_600_000 }).status).toBe('PASS');
  });
});
