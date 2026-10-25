import { afterEach, describe, expect, it, vi } from 'vitest';
import { outbound, windowRun } from './synthetic-run';
import { localTime, proactiveWorkingHours } from './proactive-working-hours';

const at = { id: 'P-06.C3', evaluatedAt: 'observation-window' };
const utc = { timezone: 'UTC' };
const single = (occurredAt: string) => windowRun('P-06', [outbound('m1', occurredAt)]);

describe('proactive-working-hours', () => {
  it('FAILs 18:00 local (end exclusive) with the timestamp and local time', () => {
    expect(proactiveWorkingHours.run(single('2026-01-06T18:00:00.000Z'), at, utc)).toEqual({
      status: 'FAIL',
      evidence: '2026-01-06T18:00:00.000Z (local 18:00 UTC)',
    });
  });

  it('FAILs 08:59 local and PASSes 09:00 local (start inclusive)', () => {
    expect(proactiveWorkingHours.run(single('2026-01-06T08:59:00.000Z'), at, utc)).toEqual({
      status: 'FAIL',
      evidence: '2026-01-06T08:59:00.000Z (local 08:59 UTC)',
    });
    expect(proactiveWorkingHours.run(single('2026-01-06T09:00:00.000Z'), at, utc)).toEqual({ status: 'PASS' });
    expect(proactiveWorkingHours.run(single('2026-01-06T17:59:00.000Z'), at, utc)).toEqual({ status: 'PASS' });
  });

  it('PASSes Saturday 10:00 (any day counts)', () => {
    expect(proactiveWorkingHours.run(single('2026-01-10T10:00:00.000Z'), at, utc)).toEqual({ status: 'PASS' });
  });

  it('uses the local hour of the given time zone', () => {
    const run = single('2026-01-06T07:30:00.000Z');
    expect(proactiveWorkingHours.run(run, at, { timezone: 'Europe/Kyiv' })).toEqual({ status: 'PASS' });
    expect(proactiveWorkingHours.run(run, at, utc)).toEqual({
      status: 'FAIL',
      evidence: '2026-01-06T07:30:00.000Z (local 07:30 UTC)',
    });
  });

  it('lists every offending initiation', () => {
    const run = windowRun('P-06', [
      outbound('m1', '2026-01-05T22:00:00.000Z'),
      outbound('m2', '2026-01-07T10:00:00.000Z'),
      outbound('m3', '2026-01-09T03:15:00.000Z'),
    ]);
    expect(proactiveWorkingHours.run(run, at, utc)).toEqual({
      status: 'FAIL',
      evidence: '2026-01-05T22:00:00.000Z (local 22:00 UTC)\n2026-01-09T03:15:00.000Z (local 03:15 UTC)',
    });
  });

  it('is NOT_OBSERVABLE no-initiations with no proactive message', () => {
    const run = windowRun('P-06', [outbound('r1', '2026-01-06T20:00:00.000Z', null)]);
    expect(proactiveWorkingHours.run(run, at, utc)).toEqual({ status: 'NOT_OBSERVABLE', evidence: 'no-initiations' });
  });

  it('validates the time zone in its params schema and requires it', () => {
    const schema = proactiveWorkingHours.params!;
    expect(schema.safeParse({ timezone: 'Europe/Kyiv' }).success).toBe(true);
    expect(schema.safeParse({ timezone: 'Mars/Olympus' }).success).toBe(false);
    expect(schema.safeParse({ timezone: 'UTC' }).success).toBe(true);
    expect(schema.safeParse({ timezone: 'Etc/UTC' }).success).toBe(true);
    expect(schema.safeParse({ timezone: 'America/Argentina/Buenos_Aires' }).success).toBe(true);
    expect(schema.safeParse({ timezone: '+02:00' }).success).toBe(false);
    expect(schema.safeParse({ timezone: 'EST' }).success).toBe(false);
    expect(schema.safeParse(undefined).success).toBe(false);
    expect(schema.safeParse({ timezone: 'UTC', startHour: 8 }).success).toBe(false);
  });

  it('follows the Europe/Kyiv DST shift (UTC+2 in winter, UTC+3 from 2026-03-29)', () => {
    const kyiv = { timezone: 'Europe/Kyiv' };
    // 06:00 UTC is 08:00 local on the Saturday before the switch and 09:00 local after it.
    expect(proactiveWorkingHours.run(single('2026-03-28T06:00:00.000Z'), at, kyiv)).toEqual({
      status: 'FAIL',
      evidence: '2026-03-28T06:00:00.000Z (local 08:00 Europe/Kyiv)',
    });
    expect(proactiveWorkingHours.run(single('2026-03-30T06:00:00.000Z'), at, kyiv)).toEqual({ status: 'PASS' });
    // On the switch day 03:00 local jumps to 04:00: 00:59 UTC is 02:59 local, 01:00 UTC is 04:00 local.
    expect(localTime('2026-03-29T00:59:00.000Z', 'Europe/Kyiv')).toBe('02:59');
    expect(localTime('2026-03-29T01:00:00.000Z', 'Europe/Kyiv')).toBe('04:00');
    expect(proactiveWorkingHours.run(single('2026-03-29T00:59:00.000Z'), at, kyiv)).toEqual({
      status: 'FAIL',
      evidence: '2026-03-29T00:59:00.000Z (local 02:59 Europe/Kyiv)',
    });
    expect(proactiveWorkingHours.run(single('2026-03-29T01:00:00.000Z'), at, kyiv)).toEqual({
      status: 'FAIL',
      evidence: '2026-03-29T01:00:00.000Z (local 04:00 Europe/Kyiv)',
    });
    // Matrix row: 07:30 UTC in summer is 10:30 local.
    expect(localTime('2026-07-01T07:30:00.000Z', 'Europe/Kyiv')).toBe('10:30');
    expect(proactiveWorkingHours.run(single('2026-07-01T07:30:00.000Z'), at, kyiv)).toEqual({ status: 'PASS' });
    // 15:00 UTC is 17:00 local in winter and 18:00 local in summer.
    expect(proactiveWorkingHours.run(single('2026-01-06T15:00:00.000Z'), at, kyiv)).toEqual({ status: 'PASS' });
    expect(proactiveWorkingHours.run(single('2026-07-01T15:00:00.000Z'), at, kyiv)).toEqual({
      status: 'FAIL',
      evidence: '2026-07-01T15:00:00.000Z (local 18:00 Europe/Kyiv)',
    });
  });

  describe('localTime', () => {
    afterEach(() => vi.restoreAllMocks());

    it('formats the local HH:MM', () => {
      expect(localTime('2026-01-06T07:30:00.000Z', 'Europe/Kyiv')).toBe('09:30');
      expect(localTime('2026-01-06T00:05:00.000Z', 'UTC')).toBe('00:05');
    });

    it('throws instead of defaulting when formatToParts omits a part', () => {
      vi.spyOn(Intl.DateTimeFormat.prototype, 'formatToParts').mockReturnValue([{ type: 'hour', value: '10' }]);
      expect(() => localTime('2026-01-06T10:00:00.000Z', 'UTC')).toThrow(/no minute/);
    });
  });
});
